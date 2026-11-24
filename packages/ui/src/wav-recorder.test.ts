import { describe, expect, it } from "vitest";
import { encodeWav, floatToInt16 } from "./wav-recorder";

describe("floatToInt16", () => {
  it("maps full scale and clamps out-of-range samples", () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(2.5)).toBe(32767);
    expect(floatToInt16(-3)).toBe(-32768);
  });

  it("treats non-finite samples as silence", () => {
    expect(floatToInt16(Number.NaN)).toBe(0);
    expect(floatToInt16(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit stereo PCM header and interleaved samples", async () => {
    const left = [Int16Array.from([100, -200]), Int16Array.from([300])];
    const right = [Int16Array.from([1, 2]), Int16Array.from([3])];
    const blob = encodeWav(left, right, 48000);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 3 * 4);
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(12)).toBe("fmt ");
    expect(ascii(36)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([100, 1, -200, 2, 300, 3]);
  });

  it("rejects channels of different length", () => {
    expect(() => encodeWav([Int16Array.of(1)], [Int16Array.of(1, 2)], 44100)).toThrow(
      "equal length",
    );
  });

  it("produces a header-only file for an empty take", async () => {
    const blob = encodeWav([], [], 44100);
    expect(blob.size).toBe(44);
  });
});
