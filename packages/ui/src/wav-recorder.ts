/**
 * Real-time WAV capture of the studio's output.
 *
 * The recorder taps the output analyser (a pass-through sink fed by
 * superdough's master gain), so playback routing is untouched. Samples are
 * stored as 16-bit PCM to keep a five-minute stereo take near 55 MB.
 * ScriptProcessorNode is deprecated but works in every browser and, unlike an
 * AudioWorklet loaded from a Blob, needs no CSP change.
 */

/** Hard cap so a forgotten recording cannot exhaust browser memory. */
export const MAX_WAV_SECONDS = 300;

const BUFFER_FRAMES = 4096;

export function floatToInt16(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** Encodes equal-length channel chunks as a 16-bit stereo PCM WAV file. */
export function encodeWav(
  left: readonly Int16Array[],
  right: readonly Int16Array[],
  sampleRate: number,
): Blob {
  const frames = left.reduce((total, chunk) => total + chunk.length, 0);
  const rightFrames = right.reduce((total, chunk) => total + chunk.length, 0);
  if (frames !== rightFrames) throw new Error("WAV channels must have equal length.");
  const dataBytes = frames * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // byte rate
  view.setUint16(32, 4, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let chunkIndex = 0; chunkIndex < left.length; chunkIndex += 1) {
    const l = left[chunkIndex];
    const r = right[chunkIndex];
    if (!l || !r) continue;
    for (let frame = 0; frame < l.length; frame += 1) {
      view.setInt16(offset, l[frame] ?? 0, true);
      view.setInt16(offset + 2, r[frame] ?? 0, true);
      offset += 4;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export interface WavRecording {
  /** Seconds captured so far. */
  elapsedSeconds(): number;
  /** Stops capturing and returns the WAV, or null if nothing was captured. */
  finish(): Blob | null;
  /** Stops capturing and discards the take. */
  cancel(): void;
}

/**
 * Starts capturing `source`. `onLimit` fires once when MAX_WAV_SECONDS is
 * reached; the take is kept so the caller can still call finish().
 */
export function startWavRecording(
  source: AudioNode,
  onLimit: () => void = () => {},
): WavRecording {
  const context = source.context;
  const processor = context.createScriptProcessor(BUFFER_FRAMES, 2, 2);
  const mute = context.createGain();
  mute.gain.value = 0;
  const left: Int16Array[] = [];
  const right: Int16Array[] = [];
  let frames = 0;
  let active = true;
  let limitReported = false;

  processor.onaudioprocess = (event) => {
    if (!active) return;
    const input = event.inputBuffer;
    const l = input.getChannelData(0);
    const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l;
    const outL = new Int16Array(l.length);
    const outR = new Int16Array(l.length);
    for (let index = 0; index < l.length; index += 1) {
      outL[index] = floatToInt16(l[index] ?? 0);
      outR[index] = floatToInt16(r[index] ?? 0);
    }
    left.push(outL);
    right.push(outR);
    frames += l.length;
    if (frames >= MAX_WAV_SECONDS * context.sampleRate) {
      active = false;
      if (!limitReported) {
        limitReported = true;
        onLimit();
      }
    }
  };

  // The processor must reach the destination for browsers to keep it running;
  // the muted gain keeps it silent.
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  const teardown = () => {
    active = false;
    processor.onaudioprocess = null;
    try {
      source.disconnect(processor);
    } catch {
      // Already disconnected.
    }
    processor.disconnect();
    mute.disconnect();
  };

  return {
    elapsedSeconds: () => frames / context.sampleRate,
    finish: () => {
      teardown();
      return frames === 0 ? null : encodeWav(left, right, context.sampleRate);
    },
    cancel: teardown,
  };
}
