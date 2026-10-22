// Short synthesized cues per state (WebAudio): no sound files, distinct enough to tell apart without looking.
// Each note is a soft mallet: a sine fundamental with two quickly fading overtones and a slightly detuned twin, struck
// and left to ring out, through a low-pass filter and a small generated room. Cues use consonant intervals, so they
// sound like a chime instead of a beep.
import type { SoundState } from '../../core/types';

interface Note {
  /** Pitch in Hz. */
  freq: number;
  /** Seconds after the cue starts. */
  start: number;
  /** Seconds until the note has faded out. */
  decay: number;
  /** Relative loudness, 1 = full. */
  level?: number;
}

// Note names for readable cues (equal temperament, A4 = 440 Hz).
const A3 = 220;
const C4 = 261.63;
const E4 = 329.63;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const D6 = 1174.66;

const CUES: Record<SoundState, Note[]> = {
  // rising fifth: something waits for your approval
  needsApproval: [
    { freq: C5, start: 0, decay: 0.5 },
    { freq: G5, start: 0.12, decay: 0.9 },
  ],
  // three rising notes, like a raised voice at the end of a question
  needsInput: [
    { freq: G5, start: 0, decay: 0.35, level: 0.8 },
    { freq: A5, start: 0.09, decay: 0.35, level: 0.8 },
    { freq: D6, start: 0.18, decay: 0.9 },
  ],
  // falling to a soft major chord: turn finished
  done: [
    { freq: G5, start: 0, decay: 0.5, level: 0.7 },
    { freq: C5, start: 0.13, decay: 1.1, level: 0.8 },
    { freq: E5, start: 0.13, decay: 1.1, level: 0.5 },
  ],
  // low falling minor third: the turn failed
  error: [
    { freq: C4, start: 0, decay: 0.6 },
    { freq: A3, start: 0.16, decay: 1 },
  ],
  // the same low note twice: rate limit reached
  limitHit: [
    { freq: E4, start: 0, decay: 0.45 },
    { freq: E4, start: 0.22, decay: 0.8 },
  ],
  // three quiet falling notes: the context window is filling up
  contextFull: [
    { freq: B5, start: 0, decay: 0.3, level: 0.6 },
    { freq: A5, start: 0.1, decay: 0.3, level: 0.6 },
    { freq: G5, start: 0.2, decay: 0.7, level: 0.6 },
  ],
};

/** Most urgent first; when several sessions change at once only the most urgent cue plays. */
export const SOUND_PRIORITY: SoundState[] = ['needsApproval', 'needsInput', 'limitHit', 'error', 'contextFull', 'done'];

/** The partials of one strike: ratio to the fundamental, level, and how fast it fades relative to the note. */
const PARTIALS = [
  { ratio: 1, level: 1, decay: 1 },
  { ratio: 2, level: 0.22, decay: 0.45 },
  { ratio: 4.01, level: 0.1, decay: 0.15 },
];
/** A second fundamental a few cents sharp gives the slow beating of a real bar. */
const DETUNE_CENTS = 4;
const PEAK_GAIN = 0.32;
const REVERB_SECONDS = 1.4;
const REVERB_MIX = 0.22;

let context: AudioContext | null = null;
let input: AudioNode | null = null;

/** A short, dark room: stereo noise with an exponential tail. */
function roomImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

/** Shared chain: low-pass, dry plus room, and a compressor so stacked notes do not clip. */
function audio(): { ctx: AudioContext; in: AudioNode } {
  if (!context || !input) {
    const ctx = new AudioContext();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 4;
    compressor.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4200;
    filter.Q.value = 0.5;
    filter.connect(compressor);
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = REVERB_MIX;
    filter.connect(room).connect(wet).connect(compressor);
    context = ctx;
    input = filter;
  }
  return { ctx: context, in: input };
}

function strike(ctx: AudioContext, out: AudioNode, note: Note, start: number, level: number): void {
  const voices = [...PARTIALS.map((p) => ({ ...p, cents: 0 })), { ...PARTIALS[0]!, level: 0.35, cents: DETUNE_CENTS }];
  for (const voice of voices) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = note.freq * voice.ratio;
    osc.detune.value = voice.cents;
    const peak = Math.max(0.0002, PEAK_GAIN * level * (note.level ?? 1) * voice.level);
    const end = start + note.decay * voice.decay;
    // A few milliseconds of attack keep the strike soft; the exponential fade is how a struck bar rings out.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

/** Plays the cue of a state at `volume` (0..100). */
export function playCue(state: SoundState, volume: number): void {
  const level = Math.max(0, Math.min(100, volume)) / 100;
  if (level === 0) return;
  const { ctx, in: out } = audio();
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime + 0.02;
  for (const note of CUES[state]) strike(ctx, out, note, now + note.start, level);
}
