// The v3 sound engine: a typed port of the approved reference's `makeSfx`
// (docs/design-system.md, Part I, Sound). Everything is synthesized with Web
// Audio; there are no audio files. Nothing is created until the reader turns
// sound on with the footer control (a user gesture), turning it off suspends
// the context, and it is never on at the start of a visit.
//
// The engine is a module singleton so that a reader's choice holds across the
// client router's navigations within one tab. It is never persisted.

export type SoundName =
  | "rec"
  | "whoosh"
  | "drop"
  | "place"
  | "pop"
  | "write"
  | "sleeve"
  | "grow"
  | "rip"
  | "scribble"
  | "click"
  | "open"
  | "close";

interface NoiseOptions {
  t?: number;
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  q?: number;
  g?: number;
  a?: number;
}

interface ToneOptions {
  t?: number;
  type?: OscillatorType;
  f2?: number;
  g?: number;
}

type Listener = (on: boolean) => void;

/** Bursts allowed within BURST_WINDOW_MS before further sounds are dropped. */
export const BURST_LIMIT = 7;
export const BURST_WINDOW_MS = 400;

export interface SoundEngine {
  isOn(): boolean;
  set(on: boolean): void;
  play(name: SoundName, at?: number, force?: boolean): void;
  subscribe(listener: Listener): () => void;
}

type AudioContextConstructor = new () => AudioContext;

/** Builds an engine. `audio` is injectable for tests. */
export function createSoundEngine(
  audio: () => AudioContextConstructor | undefined = () =>
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextConstructor })
          .webkitAudioContext),
  now: () => number = () => performance.now(),
): SoundEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let buffer: AudioBuffer | null = null;
  let on = false;
  let burst: number[] = [];
  const listeners = new Set<Listener>();
  const random = Math.random;

  const time = () => (ctx ? ctx.currentTime : 0);

  const noise = (duration: number, o: NoiseOptions = {}) => {
    if (!ctx || !master || !buffer) return;
    const t0 = time() + (o.t ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? "bandpass";
    filter.frequency.setValueAtTime(o.f ?? 1200, t0);
    if (o.f2)
      filter.frequency.exponentialRampToValueAtTime(o.f2, t0 + duration);
    filter.Q.value = o.q ?? 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(o.g ?? 0.2, t0 + (o.a ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0, random() * 1.5);
    source.stop(t0 + duration + 0.05);
  };

  const tone = (frequency: number, duration: number, o: ToneOptions = {}) => {
    if (!ctx || !master) return;
    const t0 = time() + (o.t ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(frequency, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(o.g ?? 0.1, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };

  const sounds: Record<SoundName, (t: number) => void> = {
    rec: (t) => {
      noise(0.08, { t, f: 2600, q: 0.6, g: 0.32 });
      tone(55, 0.55, { t, g: 0.3, f2: 36 });
    },
    whoosh: (t) =>
      noise(0.85, { t, f: 330, f2: 2400, q: 1.1, g: 0.13, a: 0.38 }),
    drop: (t) => {
      noise(0.32, { t, f: 2800, q: 0.7, g: 0.09, a: 0.03 });
      noise(0.04, { t: t + 0.45, f: 4200, q: 1.5, g: 0.28 });
      tone(1500, 0.06, { t: t + 0.45, g: 0.05, type: "triangle" });
    },
    place: (t) =>
      noise(0.45, { t, f: 1500, f2: 760, q: 0.6, g: 0.11, a: 0.08 }),
    pop: (t) => {
      noise(0.1, { t, f: 1000, q: 1.2, g: 0.2 });
      tone(240, 0.08, { t, g: 0.06 });
    },
    write: (t) => {
      for (let i = 0; i < 9; i++) {
        noise(0.05 + random() * 0.03, {
          t: t + i * 0.11 + random() * 0.03,
          f: 3400 + random() * 1400,
          q: 3.5,
          g: 0.012 + random() * 0.012,
          a: 0.01,
        });
      }
    },
    sleeve: (t) => {
      noise(1.25, { t: t + 0.4, f: 240, f2: 1300, q: 0.9, g: 0.12, a: 0.55 });
      tone(62, 0.7, { t: t + 0.85, g: 0.06 });
    },
    grow: (t) => tone(420 + random() * 380, 0.08, { t, g: 0.028 }),
    rip: (t) => {
      for (let i = 0; i < 36; i++) {
        noise(0.045 + random() * 0.05, {
          t: t + 0.2 + i * 0.045 + random() * 0.02,
          f: 900 + i * 50 + random() * 600,
          q: 2,
          g: 0.06 + random() * 0.07,
          a: 0.003,
        });
      }
    },
    // A pencil circling a word: graphite grains riding one loop of the hand.
    scribble: (t) => {
      const loop = 0.5;
      noise(loop, { t, f: 950, q: 0.7, g: 0.022, a: 0.06 });
      for (let i = 0; i < 30; i++) {
        const x = i / 30;
        const swell =
          0.35 +
          0.65 *
            Math.sin(Math.PI * x) *
            (0.75 + 0.25 * Math.sin(x * Math.PI * 4));
        noise(0.03 + random() * 0.025, {
          t: t + x * loop + random() * 0.012,
          f: 3000 + random() * 2200,
          q: 2.4,
          g: (0.034 + random() * 0.03) * swell,
          a: 0.004,
        });
      }
    },
    // A ballpoint pen click: the press, then the spring coming back.
    click: (t) => {
      noise(0.014, { t, f: 4200, q: 2.2, g: 0.16, a: 0.001 });
      tone(2400, 0.022, { t, g: 0.03, type: "triangle" });
      noise(0.012, { t: t + 0.075, f: 5200, q: 2.6, g: 0.08, a: 0.001 });
      tone(3100, 0.016, { t: t + 0.075, g: 0.015, type: "triangle" });
    },
    open: (t) =>
      noise(0.38, { t, f: 1200, f2: 2300, q: 0.7, g: 0.09, a: 0.05 }),
    close: (t) => noise(0.26, { t, f: 1800, f2: 900, q: 0.7, g: 0.06 }),
  };

  const notify = () => listeners.forEach((listener) => listener(on));

  return {
    isOn: () => on,
    set(value) {
      on = value;
      if (value) {
        if (!ctx) {
          const Constructor = audio();
          if (!Constructor) {
            on = false;
            notify();
            return;
          }
          ctx = new Constructor();
          master = ctx.createGain();
          master.gain.value = 0.45;
          master.connect(ctx.destination);
          buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
        }
        void ctx.resume();
        sounds.rec(0.05);
      } else if (ctx) {
        void ctx.suspend();
      }
      notify();
    },
    play(name, at = 0, force = false) {
      if (!on || !ctx) return;
      if (!force) {
        const n = now();
        burst = burst.filter((x) => n - x < BURST_WINDOW_MS);
        if (burst.length > BURST_LIMIT) return;
        burst.push(n);
      }
      sounds[name](at);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let shared: SoundEngine | null = null;

/** The tab's one engine. */
export function soundEngine(): SoundEngine {
  shared ??= createSoundEngine();
  return shared;
}

/** The sound a revealed element makes, by its entrance kind. */
export const REVEAL_SOUNDS: Readonly<Partial<Record<string, SoundName>>> = {
  left: "whoosh",
  drop: "drop",
  place: "place",
  pop: "pop",
  write: "write",
  rec: "rec",
  sleeve: "sleeve",
};
