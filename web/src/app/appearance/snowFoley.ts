// Continuous friction, not a new per-pointer-event noise burst.
type TimerId = ReturnType<typeof setTimeout>;
type Timers = { set: (callback: () => void, ms: number) => TimerId; clear: (id: TimerId) => void };
const buffers = new WeakMap<BaseAudioContext, AudioBuffer>();
export function snowNoise(context: BaseAudioContext): AudioBuffer {
  const cached = buffers.get(context); if (cached) return cached;
  const overlap = Math.round(context.sampleRate * .08);
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * 3) + overlap, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let low = 0, mid = 0;
  for (let i = 0; i < samples.length; i++) {
    const white = Math.random() * 2 - 1;
    low = .98 * low + .02 * white;
    mid = .84 * mid + .16 * white;
    samples[i] = low * .8 + mid * .45 + white * .035;
  }
  // Blend the loop tail into the head. Next loop starts at overlap, so its
  // samples continue naturally rather than clicking at the buffer boundary.
  for (let i = 0; i < overlap; i++) {
    const index = samples.length - overlap + i, mix = i / (overlap - 1);
    samples[index] = samples[index] * (1 - mix) + samples[i] * mix;
  }
  buffers.set(context, buffer); return buffer;
}

export function createSnowFoley(context: AudioContext, timers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms), clear: (id) => clearTimeout(id),
}) {
  let voice: { source: AudioBufferSourceNode; low: BiquadFilterNode; high: BiquadFilterNode; gain: GainNode } | null = null;
  let idle: TimerId | null = null, tail: TimerId | null = null, disposed = false;
  const cancel = () => { if (idle !== null) timers.clear(idle); if (tail !== null) timers.clear(tail); idle = null; tail = null; };
  const destroy = () => {
    if (!voice) return;
    voice.source.stop(); voice.source.disconnect(); voice.low.disconnect(); voice.high.disconnect(); voice.gain.disconnect(); voice = null;
  };
  const target = (param: AudioParam, value: number, time: number) => {
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(context.currentTime);
    else { const current = param.value; param.cancelScheduledValues(context.currentTime); param.setValueAtTime(current, context.currentTime); }
    param.setTargetAtTime(value, context.currentTime, time);
  };
  const release = () => {
    cancel();
    if (!voice) return;
    target(voice.gain.gain, 0, .085);
    tail = timers.set(() => { tail = null; destroy(); }, 550);
  };
  const stroke = (strength = .5, holdMs = 160, texture: "brush" | "roll" = "brush") => {
    if (disposed) return;
    cancel();
    if (!voice) {
      const source = context.createBufferSource(); source.buffer = snowNoise(context); source.loop = true;
      source.loopStart = .08; source.loopEnd = source.buffer.duration;
      const low = context.createBiquadFilter(); low.type = "lowpass"; low.Q.value = .45;
      const high = context.createBiquadFilter(); high.type = "highpass"; high.frequency.value = 95; high.Q.value = .5;
      const gain = context.createGain(); gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(high).connect(low).connect(gain).connect(context.destination);
      voice = { source, low, high, gain }; source.start(context.currentTime, .08);
    }
    const amount = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : .5));
    target(voice.low.frequency, texture === "roll" ? 340 + amount * 220 : 650 + amount * 450, .09);
    target(voice.gain.gain, .018 + amount * .052, .065);
    idle = timers.set(release, holdMs);
  };
  return { stroke, release, dispose: () => { disposed = true; cancel(); destroy(); } };
}
