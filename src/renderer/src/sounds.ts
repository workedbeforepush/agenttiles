// Short synthesized cues per state (WebAudio): no sound files, distinct enough to tell apart without looking.
import type { SoundState } from '../../core/types';

interface Note {
  freq: number;
  start: number;
  length: number;
  type: OscillatorType;
}

const CUES: Record<SoundState, Note[]> = {
  // two rising tones: something waits for your approval
  needsApproval: [
    { freq: 660, start: 0, length: 0.12, type: 'triangle' },
    { freq: 880, start: 0.14, length: 0.16, type: 'triangle' },
  ],
  // one bright tone: a question
  needsInput: [{ freq: 1047, start: 0, length: 0.22, type: 'sine' }],
  // soft falling pair: turn finished
  done: [
    { freq: 784, start: 0, length: 0.14, type: 'sine' },
    { freq: 523, start: 0.15, length: 0.22, type: 'sine' },
  ],
  // low tone: the turn failed
  error: [{ freq: 196, start: 0, length: 0.32, type: 'square' }],
  // low double: rate limit reached
  limitHit: [
    { freq: 220, start: 0, length: 0.14, type: 'triangle' },
    { freq: 220, start: 0.2, length: 0.2, type: 'triangle' },
  ],
  // three quick falling tones: the context window is filling up
  contextFull: [
    { freq: 988, start: 0, length: 0.08, type: 'sine' },
    { freq: 880, start: 0.1, length: 0.08, type: 'sine' },
    { freq: 740, start: 0.2, length: 0.12, type: 'sine' },
  ],
};

/** Most urgent first; when several sessions change at once only the most urgent cue plays. */
export const SOUND_PRIORITY: SoundState[] = ['needsApproval', 'needsInput', 'limitHit', 'error', 'contextFull', 'done'];

/** Peak level per waveform at 100 % volume; square sounds louder than sine at the same level. */
const PEAK_GAIN: Record<OscillatorType, number> = { sine: 0.75, triangle: 0.7, square: 0.3, sawtooth: 0.3, custom: 0.5 };

let context: AudioContext | null = null;
let output: AudioNode | null = null;

/** Shared output with a compressor, so loud cues do not clip. */
function audio(): { ctx: AudioContext; out: AudioNode } {
  if (!context || !output) {
    context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 4;
    compressor.connect(context.destination);
    output = compressor;
  }
  return { ctx: context, out: output };
}

/** Plays the cue of a state at `volume` (0..100). */
export function playCue(state: SoundState, volume: number): void {
  const level = Math.max(0, Math.min(100, volume)) / 100;
  if (level === 0) return;
  const { ctx, out } = audio();
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime + 0.02;
  for (const note of CUES[state]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;
    const start = now + note.start;
    const end = start + note.length;
    // Short attack and exponential release: no clicks.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, PEAK_GAIN[note.type] * level), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}
