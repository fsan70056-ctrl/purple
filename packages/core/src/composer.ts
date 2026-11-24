/**
 * Rule-based instrumental arranger for the "create" mode.
 *
 * It turns a handful of parameters into a Strudel expression using only the
 * engine's built-in oscillators (sawtooth, triangle, sine, square) and white
 * noise for percussion, so it needs no sample packs, no network and no paid
 * AI. It is deliberately NOT generative AI: the same parameters and seed
 * always give the same code. It writes no vocals and no lyrics.
 */

export const GENRES = ["lofi", "pop", "edm", "ambient", "cinematic", "funk"] as const;
export const MOODS = ["happy", "calm", "sad", "epic", "mysterious"] as const;
export const INSTRUMENTS = ["keys", "bass", "lead", "pad", "pluck", "drums"] as const;
export const DURATIONS_SECONDS = [30, 60, 120, 180] as const;

export type Genre = (typeof GENRES)[number];
export type Mood = (typeof MOODS)[number];
export type Instrument = (typeof INSTRUMENTS)[number];

export const MIN_BPM = 60;
export const MAX_BPM = 180;

export interface ComposeParams {
  genre: Genre;
  mood: Mood;
  bpm: number;
  instruments: readonly Instrument[];
  durationSeconds: number;
}

export interface Composition {
  title: string;
  code: string;
  /** One line a person can read: key, tempo, layers. */
  summary: string;
  bars: number;
  /** Key, tempo and chord roots, so a vocal line can be written on the same grid as the code. */
  meta: CompositionMeta;
}

export interface CompositionMeta {
  bpm: number;
  root: string;
  mode: "major" | "minor" | "phrygian";
  /** Scale degree (0-6) of each bar's chord root; one chord per bar, cycling. */
  progression: number[];
}

interface GenreSpec {
  label: string;
  blurb: string;
  bpm: number;
  instruments: readonly Instrument[];
  kick: readonly string[];
  snare: readonly string[];
  hat: readonly string[];
  bass: readonly string[];
  keys: readonly string[];
  keysWave: string;
  bassWave: string;
  leadWave: string;
  tone: number;
  restProbability: number;
  pluckSteps: number;
}

export const GENRE_SPECS: Readonly<Record<Genre, GenreSpec>> = {
  lofi: {
    label: "轻松 Lo-fi",
    blurb: "慵懒松弛，适合学习和发呆",
    bpm: 78,
    instruments: ["keys", "bass", "pluck", "drums"],
    kick: ["x ~ ~ x ~ ~ x ~", "x ~ ~ ~ ~ x x ~"],
    snare: ["~ ~ x ~ ~ ~ x ~", "~ ~ x ~ ~ ~ x ~"],
    hat: ["x*8", "x ~ x x ~ x x ~"],
    bass: ["x ~ ~ x ~ ~ x ~", "x ~ ~ ~ x ~ ~ x"],
    keys: ["x ~ ~ x ~ ~ x ~", "x ~ ~ ~ x ~ x ~"],
    keysWave: "triangle",
    bassWave: "sine",
    leadWave: "triangle",
    tone: 1300,
    restProbability: 0.45,
    pluckSteps: 8,
  },
  pop: {
    label: "流行",
    blurb: "旋律清晰，抓耳好记",
    bpm: 108,
    instruments: ["keys", "bass", "lead", "drums"],
    kick: ["x ~ ~ ~ x ~ ~ ~", "x ~ ~ x x ~ ~ ~"],
    snare: ["~ ~ x ~ ~ ~ x ~", "~ ~ x ~ ~ ~ x x"],
    hat: ["x*8", "x ~ x ~ x ~ x ~"],
    bass: ["x ~ x x ~ x ~ x", "x x ~ x x ~ x ~"],
    keys: ["x ~ x x ~ x x ~", "x x ~ x ~ x x ~"],
    keysWave: "triangle",
    bassWave: "sawtooth",
    leadWave: "square",
    tone: 2600,
    restProbability: 0.25,
    pluckSteps: 8,
  },
  edm: {
    label: "电子舞曲",
    blurb: "四拍重鼓，适合运动和派对",
    bpm: 128,
    instruments: ["keys", "bass", "lead", "drums"],
    kick: ["x ~ x ~ x ~ x ~", "x ~ x ~ x ~ x ~"],
    snare: ["~ ~ x ~ ~ ~ x ~", "~ ~ x ~ ~ x x ~"],
    hat: ["~ x ~ x ~ x ~ x", "x*8"],
    bass: ["~ x ~ x ~ x ~ x", "x ~ x x ~ x ~ x"],
    keys: ["~ x ~ x ~ ~ x ~", "x ~ ~ x ~ x ~ ~"],
    keysWave: "sawtooth",
    bassWave: "sawtooth",
    leadWave: "sawtooth",
    tone: 3200,
    restProbability: 0.2,
    pluckSteps: 8,
  },
  ambient: {
    label: "空灵氛围",
    blurb: "缓慢悠长，适合冥想和睡前",
    bpm: 70,
    instruments: ["pad", "pluck", "lead"],
    kick: ["x ~ ~ ~ ~ ~ ~ ~", "x ~ ~ ~ ~ ~ x ~"],
    snare: ["~ ~ ~ ~ x ~ ~ ~", "~ ~ ~ ~ ~ ~ ~ x"],
    hat: ["~ ~ ~ x ~ ~ ~ ~", "~ ~ ~ ~ ~ x ~ ~"],
    bass: ["x ~ ~ ~ ~ ~ ~ ~", "x ~ ~ ~ x ~ ~ ~"],
    keys: ["x ~ ~ ~ ~ ~ ~ ~", "x ~ ~ ~ x ~ ~ ~"],
    keysWave: "sine",
    bassWave: "sine",
    leadWave: "sine",
    tone: 1000,
    restProbability: 0.6,
    pluckSteps: 8,
  },
  cinematic: {
    label: "电影感",
    blurb: "层层推进，有画面和张力",
    bpm: 90,
    instruments: ["pad", "bass", "lead", "drums"],
    kick: ["x ~ ~ ~ ~ ~ x ~", "x ~ ~ ~ x ~ ~ ~"],
    snare: ["~ ~ ~ ~ x ~ ~ ~", "~ ~ ~ ~ x ~ x ~"],
    hat: ["x ~ ~ ~ x ~ ~ ~", "x ~ ~ ~ x ~ x ~"],
    bass: ["x ~ ~ ~ ~ ~ ~ ~", "x ~ ~ ~ x ~ ~ ~"],
    keys: ["x ~ ~ ~ ~ ~ ~ ~", "x ~ ~ ~ ~ ~ x ~"],
    keysWave: "sawtooth",
    bassWave: "sawtooth",
    leadWave: "sawtooth",
    tone: 1800,
    restProbability: 0.5,
    pluckSteps: 8,
  },
  funk: {
    label: "复古放克",
    blurb: "切分律动，让人想摇摆",
    bpm: 104,
    instruments: ["keys", "bass", "lead", "drums"],
    kick: ["x ~ ~ x ~ x ~ ~", "x ~ ~ x ~ ~ x ~"],
    snare: ["~ ~ x ~ ~ ~ x ~", "~ ~ x ~ ~ x x ~"],
    hat: ["x x x x x x x x", "x ~ x x ~ x x x"],
    bass: ["x ~ x x ~ x ~ x", "x x ~ x ~ x x ~"],
    keys: ["~ x ~ x ~ ~ x ~", "~ x ~ ~ x ~ x ~"],
    keysWave: "square",
    bassWave: "square",
    leadWave: "square",
    tone: 2200,
    restProbability: 0.3,
    pluckSteps: 8,
  },
};

interface MoodSpec {
  label: string;
  mode: CompositionMeta["mode"];
  progression: readonly number[];
  brightness: number;
  room: number;
  gain: number;
}

export const MOOD_SPECS: Readonly<Record<Mood, MoodSpec>> = {
  happy: { label: "开心明亮", mode: "major", progression: [0, 4, 5, 3], brightness: 1.15, room: 0.3, gain: 1 },
  calm: { label: "平静治愈", mode: "major", progression: [0, 5, 3, 4], brightness: 0.8, room: 0.6, gain: 0.9 },
  sad: { label: "伤感怀旧", mode: "minor", progression: [0, 5, 2, 6], brightness: 0.9, room: 0.5, gain: 0.95 },
  epic: { label: "热血史诗", mode: "minor", progression: [0, 3, 5, 6], brightness: 1.25, room: 0.5, gain: 1.05 },
  mysterious: { label: "神秘悬疑", mode: "phrygian", progression: [0, 1, 5, 6], brightness: 0.85, room: 0.65, gain: 0.95 },
};

export const INSTRUMENT_LABELS: Readonly<Record<Instrument, string>> = {
  keys: "合成键盘",
  bass: "低音",
  lead: "主旋律",
  pad: "铺底音色",
  pluck: "拨弦琶音",
  drums: "鼓点",
};

const ROOTS = ["C", "D", "E", "F", "G", "A"] as const;

/** Small deterministic generator so a seed always gives the same piece. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

function chordSteps(root: number): string {
  return `[${root},${root + 2},${root + 4}]`;
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  return items[Math.abs(seed + salt) % items.length] as T;
}

function melody(progression: readonly number[], spec: GenreSpec, random: () => number): string {
  const bars = progression.map((root) => {
    const tones = [root, root + 2, root + 4, root + 7, root + 1, root + 3];
    const steps: string[] = [];
    let previous = root + 4;
    for (let step = 0; step < 8; step++) {
      const strong = step % 4 === 0;
      if (!strong && random() < spec.restProbability) {
        steps.push("~");
        continue;
      }
      const near = tones.filter((tone) => Math.abs(tone - previous) <= 3);
      const pool = near.length > 0 ? near : tones;
      const choice = pool[Math.floor(random() * pool.length)] ?? root;
      steps.push(String(choice));
      previous = choice;
    }
    return `[${steps.join(" ")}]`;
  });
  return `<${bars.join(" ")}>`;
}

function arpeggio(progression: readonly number[], steps: number): string {
  const bars = progression.map((root) => {
    const shape = [root, root + 2, root + 4, root + 7, root + 4, root + 2, root + 4, root + 2];
    return `[${shape.slice(0, steps).join(" ")}]`;
  });
  return `<${bars.join(" ")}>`;
}

export function composeSong(params: ComposeParams, seed: number): Composition {
  const genre = GENRE_SPECS[params.genre];
  const mood = MOOD_SPECS[params.mood];
  const bpm = clampBpm(params.bpm);
  const random = mulberry32(seed * 7919 + bpm);
  const rootName = pick(ROOTS, seed, 0);
  const rotation = Math.abs(seed) % mood.progression.length;
  const progression = [...mood.progression.slice(rotation), ...mood.progression.slice(0, rotation)];
  const scaleAt = (octave: number) => `${rootName}${octave}:${mood.mode}`;
  const tone = (factor = 1) => Math.round(genre.tone * mood.brightness * factor);
  const room = mood.room.toFixed(2).replace(/0$/, "");
  const chordCycle = `<${progression.map(chordSteps).join(" ")}>`;
  const rootCycle = `<${progression.join(" ")}>`;
  const selected = new Set(params.instruments);
  if (selected.size === 0) for (const name of genre.instruments) selected.add(name);

  const layers: string[] = [];
  const layerNames: Instrument[] = [];
  const add = (name: Instrument, code: string) => {
    layers.push(code);
    layerNames.push(name);
  };

  if (selected.has("pad")) {
    add(
      "pad",
      `n("${chordCycle}").scale("${scaleAt(3)}").s("sawtooth").attack(.4).release(.8).lpf(${tone(0.5)}).room(${room}).gain(${(0.16 * mood.gain).toFixed(2)})`,
    );
  }
  if (selected.has("keys")) {
    add(
      "keys",
      `n("${chordCycle}").scale("${scaleAt(4)}").s("${genre.keysWave}").struct("${pick(genre.keys, seed, 1)}").lpf(${tone()}).room(${room}).gain(${(0.22 * mood.gain).toFixed(2)})`,
    );
  }
  if (selected.has("bass")) {
    add(
      "bass",
      `n("${rootCycle}").scale("${scaleAt(2)}").s("${genre.bassWave}").struct("${pick(genre.bass, seed, 2)}").lpf(${tone(0.35)}).gain(.5)`,
    );
  }
  if (selected.has("lead")) {
    add(
      "lead",
      `n("${melody(progression, genre, random)}").scale("${scaleAt(5)}").s("${genre.leadWave}").lpf(${tone(1.4)}).delay(.25).room(${room}).gain(${(0.17 * mood.gain).toFixed(2)})`,
    );
  }
  if (selected.has("pluck")) {
    add(
      "pluck",
      `n("${arpeggio(progression, genre.pluckSteps)}").scale("${scaleAt(4)}").s("triangle").decay(.22).sustain(0).delay(.2).room(${room}).gain(.24)`,
    );
  }
  if (selected.has("drums")) {
    const kick = `note("c1").s("sine").struct("${pick(genre.kick, seed, 3)}").penv(24).pdecay(.05).decay(.22).sustain(0).gain(.9)`;
    const snare = `s("white").struct("${pick(genre.snare, seed, 4)}").decay(.12).sustain(0).bpf(1900).gain(.4)`;
    const hat = `s("white").struct("${pick(genre.hat, seed, 5)}").decay(.04).sustain(0).hpf(7500).gain(.2)`;
    add("drums", `${kick},\n  ${snare},\n  ${hat}`);
  }

  const bars = Math.max(1, Math.round((params.durationSeconds * bpm) / 240));
  const code = `stack(\n  ${layers.join(",\n  ")}\n).cpm(${bpm}/4)`;
  const keyLabel = `${rootName}${mood.mode === "major" ? "大调" : mood.mode === "minor" ? "小调" : "弗里几亚"}`;
  const names = layerNames.map((name) => INSTRUMENT_LABELS[name]).join("、");
  return {
    title: `${genre.label.replace(/^\S+\s/, "")}·${mood.label.slice(0, 2)} #${Math.abs(seed) % 1000}`.slice(0, 60),
    code,
    summary: `${keyLabel} · ${bpm} BPM · ${names}`,
    bars,
    meta: { bpm, root: rootName, mode: mood.mode, progression: [...progression] },
  };
}

/* ---------------------------------------------------------------- parsing */

export interface PromptReading {
  genre?: Genre;
  mood?: Mood;
  bpm?: number;
  instruments?: Instrument[];
  /** What was recognised, in words a person can check. */
  matched: string[];
  /** Requests the arranger cannot honour (vocals, lyrics). */
  unsupported: string[];
  /** Substitutions the person should know about. */
  notes: string[];
  understood: boolean;
}

const GENRE_WORDS: Readonly<Record<Genre, readonly string[]>> = {
  lofi: ["lofi", "lo-fi", "学习", "咖啡", "休闲", "慵懒", "深夜", "午后", "下雨", "雨夜"],
  pop: ["流行", "pop", "抒情", "好记", "朗朗上口"],
  edm: ["电子", "edm", "舞曲", "派对", "蹦迪", "跳舞", "健身", "跑步", "house", "club", "dance"],
  ambient: ["氛围", "空灵", "冥想", "睡眠", "助眠", "ambient", "瑜伽", "星空"],
  cinematic: ["电影", "史诗", "预告", "配乐", "cinematic", "trailer", "战斗", "游戏背景"],
  funk: ["放克", "funk", "律动", "复古", "迪斯科", "disco", "摇摆"],
};

const MOOD_WORDS: Readonly<Record<Mood, readonly string[]>> = {
  happy: ["开心", "快乐", "欢快", "明亮", "阳光", "happy", "活泼", "轻快", "喜庆"],
  calm: ["平静", "安静", "温柔", "放松", "舒缓", "calm", "治愈", "柔和", "宁静"],
  sad: ["伤感", "悲伤", "忧郁", "难过", "失落", "sad", "怀旧", "孤独", "思念"],
  epic: ["热血", "激昂", "壮阔", "震撼", "epic", "史诗", "燃", "气势"],
  mysterious: ["神秘", "暗黑", "悬疑", "诡异", "mysterious", "dark", "恐怖", "紧张"],
};

const INSTRUMENT_WORDS: Readonly<Record<Instrument, readonly string[]>> = {
  keys: ["键盘", "钢琴", "电钢", "keys", "piano"],
  bass: ["贝斯", "低音", "bass"],
  lead: ["主旋律", "主音", "旋律", "lead", "合成器"],
  pad: ["铺底", "弦乐", "pad", "strings"],
  pluck: ["拨弦", "琶音", "竖琴", "吉他", "pluck", "arp"],
  drums: ["鼓", "打击", "drums", "beat"],
};

const VOCAL_WORDS = ["歌词", "歌声", "人声", "演唱", "唱", "说唱", "rap", "vocal", "sing", "lyrics"];
const REAL_INSTRUMENT_WORDS = ["钢琴", "吉他", "竖琴", "弦乐", "piano"];

function firstHit<T extends string>(
  text: string,
  table: Readonly<Record<T, readonly string[]>>,
): { key: T; word: string } | undefined {
  let best: { key: T; word: string; at: number } | undefined;
  for (const key of Object.keys(table) as T[]) {
    for (const word of table[key]) {
      const at = text.indexOf(word);
      if (at >= 0 && (!best || at < best.at)) best = { key, word, at };
    }
  }
  return best && { key: best.key, word: best.word };
}

/**
 * Keyword matching only. It never claims to understand free text: anything it
 * cannot place is reported back so the screen can say so.
 */
export function readPrompt(prompt: string): PromptReading {
  const text = prompt.toLowerCase();
  const reading: PromptReading = { matched: [], unsupported: [], notes: [], understood: false };
  if (!text.trim()) return reading;

  const genre = firstHit(text, GENRE_WORDS);
  if (genre) {
    reading.genre = genre.key;
    reading.matched.push(`曲风：${GENRE_SPECS[genre.key].label}（“${genre.word}”）`);
  }
  const mood = firstHit(text, MOOD_WORDS);
  if (mood) {
    reading.mood = mood.key;
    reading.matched.push(`情绪：${MOOD_SPECS[mood.key].label}（“${mood.word}”）`);
  }

  const explicit = /(\d{2,3})\s*(?:bpm|拍)/.exec(text) ?? /bpm\s*[:：]?\s*(\d{2,3})/.exec(text);
  if (explicit) {
    const bpm = Number(explicit[1]);
    if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
      reading.bpm = bpm;
      reading.matched.push(`速度：${bpm} BPM`);
    } else {
      reading.notes.push(`速度需要在 ${MIN_BPM}–${MAX_BPM} BPM 之间，“${explicit[1]}”已忽略。`);
    }
  } else if (["快节奏", "很快", "急促", "fast"].some((word) => text.includes(word))) {
    reading.bpm = 140;
    reading.matched.push("速度：偏快（140 BPM）");
  } else if (["慢节奏", "很慢", "缓慢", "slow"].some((word) => text.includes(word))) {
    reading.bpm = 70;
    reading.matched.push("速度：偏慢（70 BPM）");
  }

  const instruments: Instrument[] = [];
  for (const name of INSTRUMENTS) {
    const word = INSTRUMENT_WORDS[name].find((candidate) => text.includes(candidate));
    if (word) {
      instruments.push(name);
      reading.matched.push(`乐器：${INSTRUMENT_LABELS[name]}（“${word}”）`);
    }
  }
  if (instruments.length > 0) reading.instruments = instruments;
  if (REAL_INSTRUMENT_WORDS.some((word) => text.includes(word))) {
    reading.notes.push("本地引擎只有合成器音色，没有真实钢琴、吉他或弦乐，已用相近的合成音色代替。");
  }

  if (VOCAL_WORDS.some((word) => text.includes(word))) {
    reading.unsupported.push("歌声、歌词和演唱");
  }

  reading.understood = reading.matched.length > 0;
  return reading;
}

/** Text for an outside AI assistant, for when the local arranger cannot read the request. */
export function buildExternalPrompt(description: string, params: ComposeParams): string {
  const genre = GENRE_SPECS[params.genre].label;
  const mood = MOOD_SPECS[params.mood].label;
  const instruments = params.instruments.map((name) => INSTRUMENT_LABELS[name]).join("、");
  return [
    "请帮我写一段 Strudel（strudel.cc）纯音乐编曲代码，只输出一个 JavaScript 表达式，不要解释。",
    `我的描述：${description.trim() || "（未填写）"}`,
    `曲风：${genre}；情绪：${mood}；速度：${clampBpm(params.bpm)} BPM；乐器：${instruments || "不限"}；时长约 ${params.durationSeconds} 秒的循环。`,
    "限制：",
    "1. 只用内置合成音色 sawtooth、triangle、sine、square，鼓用 s(\"white\") 噪声或带 penv 的 sine，不要引用任何采样库。",
    "2. 用 stack(...) 组合多个声部，结尾写 .cpm(BPM/4)。",
    "3. 只做纯音乐，不要歌词，也不要人声。",
    "写好后可粘贴到本页面「高级模式」的编辑器里播放。",
  ].join("\n");
}
