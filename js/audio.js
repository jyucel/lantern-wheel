// Lantern Wheel: synthesized audio.
// All sounds are generated with the Web Audio API at runtime, so the game
// ships no audio files. The music is a slow generative ambient piece: soft
// pad chords plus sparse pentatonic plucks through a feedback-delay "space".

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic degrees
const ROOT_HZ = 196; // G3

const hz = (semi) => ROOT_HZ * Math.pow(2, semi / 12);
const scaleNote = (i) => PENTA[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicTimer = null;
    this.chordIndex = 0;
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(c.destination);

      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.55 : 0;
      this.sfxBus.connect(this.master);

      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0;
      // gentle lowpass + feedback delay for a spacious feel
      this.musicFilter = c.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 1800;
      this.delay = c.createDelay(2);
      this.delay.delayTime.value = 0.46;
      this.feedback = c.createGain();
      this.feedback.gain.value = 0.42;
      this.wet = c.createGain();
      this.wet.gain.value = 0.35;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);
      this.musicFilter.connect(this.delay);
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.delay.connect(this.wet);
      this.wet.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.musicOn) this.startMusic();
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.02);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  // ---- primitive voices ---------------------------------------------------

  tone({ freq, type = 'sine', start = 0, dur = 0.3, gain = 0.3, attack = 0.005, bus, detune = 0, glide }) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    o.detune.value = detune;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---- sound effects -----------------------------------------------------

  /** Soft wooden tick when a ring advances one slot. Pitch varies per ring. */
  spin(ring = 0, step = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const f = hz(scaleNote(5 + ring * 2 + (step % 3)) + 12);
    this.tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.22 });
    this.tone({ freq: f * 2.01, type: 'sine', dur: 0.06, gain: 0.06 });
  }

  swap() {
    if (!this.ctx || !this.sfxOn) return;
    this.tone({ freq: hz(19), type: 'sine', dur: 0.35, gain: 0.18 });
    this.tone({ freq: hz(24), type: 'sine', start: 0.07, dur: 0.4, gain: 0.16 });
    this.tone({ freq: hz(36), type: 'sine', start: 0.07, dur: 0.2, gain: 0.04 });
  }

  /** Bell chime when a ring becomes a single color. */
  ringDone(index = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const base = 10 + index;
    [0, 2, 4].forEach((d, i) => {
      const f = hz(scaleNote(base + d) + 12);
      this.tone({ freq: f, type: 'sine', start: i * 0.06, dur: 0.9, gain: 0.14 });
      this.tone({ freq: f * 3, type: 'sine', start: i * 0.06, dur: 0.3, gain: 0.025 });
    });
  }

  win() {
    if (!this.ctx || !this.sfxOn) return;
    [0, 2, 4, 5, 7, 9, 10].forEach((d, i) => {
      const f = hz(scaleNote(d + 5) + 12);
      this.tone({ freq: f, type: 'triangle', start: i * 0.08, dur: 1.2, gain: 0.12 });
      this.tone({ freq: f * 2, type: 'sine', start: i * 0.08, dur: 0.6, gain: 0.04 });
    });
    [0, 4, 7].forEach((s) => this.tone({ freq: hz(s), type: 'sine', start: 0.55, dur: 2.2, gain: 0.08, attack: 0.2 }));
  }

  invalid() {
    if (!this.ctx || !this.sfxOn) return;
    this.tone({ freq: 140, type: 'sine', dur: 0.18, gain: 0.3, glide: 90 });
    this.tone({ freq: 70, type: 'triangle', dur: 0.12, gain: 0.12 });
  }

  click() {
    if (!this.ctx || !this.sfxOn) return;
    this.tone({ freq: 880, type: 'sine', dur: 0.05, gain: 0.08 });
  }

  undo() {
    if (!this.ctx || !this.sfxOn) return;
    this.tone({ freq: hz(14), type: 'triangle', dur: 0.12, gain: 0.14, glide: hz(9) });
  }

  // ---- ambient music -----------------------------------------------------

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.5, this.ctx.currentTime, 1.5);
    this.nextBar = this.ctx.currentTime + 0.1;
    const tick = () => {
      // schedule ahead in small chunks to stay in time when the tab is busy
      while (this.nextBar < this.ctx.currentTime + 1.5) {
        this.scheduleBar(this.nextBar);
        this.nextBar += BAR;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 400);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  scheduleBar(t) {
    const c = this.ctx;
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    this.chordIndex++;
    // pad: three detuned voices per chord tone with slow swell
    for (const semi of chord) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = hz(semi - 12);
        o.detune.value = det;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + BAR * 0.4);
        g.gain.linearRampToValueAtTime(0.0001, t + BAR * 1.05);
        o.connect(g);
        g.connect(this.musicBus);
        o.start(t);
        o.stop(t + BAR * 1.1);
      }
    }
    // sparse plucks drawn from the pentatonic scale
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const when = t + (Math.floor(Math.random() * 8) * BAR) / 8;
      const semi = scaleNote(5 + Math.floor(Math.random() * 7));
      this.tone({ freq: hz(semi), type: 'triangle', start: when - c.currentTime, dur: 1.6, gain: 0.05, bus: this.musicBus });
    }
  }
}

const BAR = 4.8; // seconds per chord
// I – vi – IV – V – I – iii – IV – ii (semitones from root)
const CHORDS = [
  [0, 4, 7, 11],
  [-3, 0, 4, 7],
  [-7, -3, 0, 4],
  [-5, -1, 2, 7],
  [0, 4, 7, 14],
  [-8, -5, -1, 4],
  [-7, -3, 0, 4],
  [-10, -7, -3, 2],
];
