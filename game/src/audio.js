// audio.js — every sound is synthesized with WebAudio. No audio files, no
// network: short noise bursts and oscillators shaped into shots, hits,
// reloads, plants, beeps and the round-end stingers.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type = 'square', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'shotgun') { noise(0.22, 900, 0.9); tone(90, 0.14, 0.5, 'sawtooth', 45); }
      else if (kind === 'dmr') { noise(0.28, 700, 0.95); tone(70, 0.2, 0.55, 'sawtooth', 38); }
      else if (kind === 'pistol') { noise(0.11, 1600, 0.7); tone(160, 0.07, 0.35, 'square', 80); }
      else { noise(0.13, 1200, 0.8); tone(120, 0.09, 0.4, 'sawtooth', 60); } // rifle
    },
    distantShot() { noise(0.16, 500, 0.28); },
    dryClick() { tone(1400, 0.04, 0.25, 'square'); },
    hit() { tone(2200, 0.05, 0.3, 'sine'); },
    kill() { tone(2200, 0.05, 0.3, 'sine'); tone(1500, 0.09, 0.3, 'sine', null, 0.06); },
    hurt() { tone(110, 0.16, 0.5, 'sawtooth', 60); noise(0.12, 400, 0.3); },
    reload() { tone(900, 0.05, 0.25, 'square'); tone(600, 0.05, 0.25, 'square', null, 0.18); tone(1100, 0.05, 0.3, 'square', null, 0.42); },
    grenadeThrow() { noise(0.1, 2000, 0.2, 'highpass'); },
    explosion() {
      noise(0.7, 300, 1.0);
      tone(55, 0.6, 0.8, 'sine', 28);
      noise(0.3, 3000, 0.4, 'highpass', 0.02);
    },
    plantTick() { tone(1250, 0.07, 0.3, 'sine'); },
    plantDone() { tone(880, 0.12, 0.35, 'sine'); tone(1320, 0.18, 0.35, 'sine', null, 0.12); },
    beep() { tone(1000, 0.1, 0.25, 'sine'); },
    buy() { tone(660, 0.07, 0.3, 'sine'); tone(990, 0.1, 0.3, 'sine', null, 0.07); },
    roundWin() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 0.3, 'triangle', null, i * 0.13));
    },
    roundLose() {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.26, 0.3, 'triangle', null, i * 0.15));
    },
    roundStart() { tone(440, 0.12, 0.3, 'triangle'); tone(660, 0.16, 0.3, 'triangle', null, 0.12); },
  };
}
