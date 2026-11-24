/**
 * The create-mode arranger must always hand the engine something it can play:
 * every genre/mood/instrument combination has to evaluate through the safe
 * interpreter, use only built-in voices, and stay deterministic per seed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildExternalPrompt,
  clampBpm,
  composeSong,
  DURATIONS_SECONDS,
  GENRES,
  INSTRUMENTS,
  MOODS,
  readPrompt,
  type ComposeParams,
} from "@purple/core/composer";
import { auditHapSounds, type AuditableHap } from "@purple/core/validation";
// @ts-expect-error @strudel/core does not publish declarations.
import { evalScope, strudelScope } from "@strudel/core";
import {
  createSafeStrudelScope,
  evaluateSafeStrudelExpression,
  isQueryablePattern,
  type SafeStrudelScope,
} from "./safe-strudel";

interface Queryable {
  queryArc: (begin: number, end: number) => AuditableHap[];
}

let scope: SafeStrudelScope;

beforeAll(async () => {
  await evalScope(
    // @ts-expect-error @strudel/core does not publish declarations.
    import("@strudel/core"),
    // @ts-expect-error @strudel/mini does not publish declarations.
    import("@strudel/mini"),
    // @ts-expect-error @strudel/tonal does not publish declarations.
    import("@strudel/tonal"),
  );
  scope = createSafeStrudelScope({ ...strudelScope });
});

const ALLOWED = new Set(["sawtooth", "triangle", "sine", "square", "white"]);

function base(over: Partial<ComposeParams> = {}): ComposeParams {
  return {
    genre: "lofi",
    mood: "calm",
    bpm: 90,
    instruments: INSTRUMENTS,
    durationSeconds: 60,
    ...over,
  };
}

function evaluate(code: string): Queryable {
  const pattern = evaluateSafeStrudelExpression(code, scope);
  if (!isQueryablePattern<Queryable>(pattern)) throw new Error("not a pattern");
  return pattern;
}

describe("composeSong", () => {
  it("offers at least five genre templates", () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(5);
  });

  for (const genre of GENRES) {
    for (const mood of MOODS) {
      it(`${genre} × ${mood} plays with built-in voices only`, () => {
        const song = composeSong(base({ genre, mood }), 3);
        const pattern = evaluate(song.code);
        const haps = pattern.queryArc(0, 8);
        expect(haps.length).toBeGreaterThan(0);
        const sounds = auditHapSounds(haps, () => false);
        expect(sounds.length).toBeGreaterThan(0);
        for (const name of sounds) expect(ALLOWED.has(name.toLowerCase())).toBe(true);
        for (const hap of haps) {
          const note = (hap as unknown as { value?: { note?: unknown; freq?: unknown } }).value;
          if (note && typeof note.note === "number") expect(Number.isFinite(note.note)).toBe(true);
        }
      });
    }
  }

  it("every instrument can play on its own", () => {
    for (const name of INSTRUMENTS) {
      const song = composeSong(base({ genre: "pop", instruments: [name] }), 1);
      expect(evaluate(song.code).queryArc(0, 8).length).toBeGreaterThan(0);
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    const a = composeSong(base({ genre: "pop" }), 5).code;
    expect(composeSong(base({ genre: "pop" }), 5).code).toBe(a);
    const others = new Set([1, 2, 3, 4, 6, 7].map((seed) => composeSong(base({ genre: "pop" }), seed).code));
    expect(others.size).toBeGreaterThan(3);
  });

  it("clamps tempo and writes it into the code", () => {
    expect(clampBpm(10)).toBe(60);
    expect(clampBpm(999)).toBe(180);
    expect(clampBpm(Number.NaN)).toBe(100);
    expect(composeSong(base({ bpm: 500 }), 1).code).toContain(".cpm(180/4)");
  });

  it("falls back to the genre's layers when nothing is selected", () => {
    const song = composeSong(base({ genre: "ambient", instruments: [] }), 1);
    expect(evaluate(song.code).queryArc(0, 4).length).toBeGreaterThan(0);
  });

  it("keeps titles within the library limit and sizes the length in bars", () => {
    for (const genre of GENRES) {
      expect(composeSong(base({ genre }), 999).title.length).toBeLessThanOrEqual(60);
    }
    expect(composeSong(base({ bpm: 120, durationSeconds: DURATIONS_SECONDS[1] }), 1).bars).toBe(30);
  });
});

describe("composition meta (shared with the local vocal backend)", () => {
  it("exposes tempo, key and one chord root per bar that match the code", () => {
    const made = composeSong(base(), 12);
    expect(made.meta.bpm).toBe(90);
    expect(made.code).toContain(`.cpm(${made.meta.bpm}/4)`);
    expect(made.code).toContain(`.scale("${made.meta.root}3:${made.meta.mode}")`);
    expect(made.meta.progression).toHaveLength(4);
    expect(made.meta.progression.every((degree) => degree >= 0 && degree <= 6)).toBe(true);
    expect(made.code).toContain(
      `n("<${made.meta.progression.map((root) => `[${root},${root + 2},${root + 4}]`).join(" ")}>")`,
    );
  });
});

describe("readPrompt", () => {
  it("reads genre, mood, tempo and instruments from keywords", () => {
    const reading = readPrompt("雨夜咖啡馆，平静的 lofi，80 BPM，要有贝斯和鼓");
    expect(reading.genre).toBe("lofi");
    expect(reading.mood).toBe("calm");
    expect(reading.bpm).toBe(80);
    expect(reading.instruments).toEqual(expect.arrayContaining(["bass", "drums"]));
    expect(reading.understood).toBe(true);
  });

  it("reports text it cannot place instead of guessing", () => {
    const reading = readPrompt("一只猫在窗台上");
    expect(reading.understood).toBe(false);
    expect(reading.matched).toEqual([]);
  });

  it("refuses vocals and lyrics, and says synth voices replace real instruments", () => {
    const reading = readPrompt("温柔的钢琴曲，带歌词和女声演唱");
    expect(reading.unsupported.length).toBe(1);
    expect(reading.notes.join("")).toContain("合成");
  });

  it("ignores out-of-range tempo with a note", () => {
    const reading = readPrompt("电子舞曲 400bpm");
    expect(reading.bpm).toBeUndefined();
    expect(reading.notes.join("")).toContain("60");
  });

  it("builds an instruction for outside AI that forbids vocals and samples", () => {
    const text = buildExternalPrompt("深夜写代码", base());
    expect(text).toContain("深夜写代码");
    expect(text).toContain("不要歌词");
    expect(text).toContain("采样");
  });
});
