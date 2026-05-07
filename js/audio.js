'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SoundEngine — all Web Audio API synthesis, no external assets required.
// Instantiated as a global singleton `SFX`.
// AudioContext is created lazily on first call (requires a user gesture).
// ─────────────────────────────────────────────────────────────────────────────

class SoundEngine {
  constructor() {
    this.ctx        = null;
    this._ready     = false;
    this._noiseBuf  = null;

    // Music scheduler
    this._musicOn      = false;
    this._nextBarTime  = 0;
    this._barIndex     = 0;
    this._lookahead    = 0.18;   // seconds to schedule ahead
    this._schedHandle  = null;

    // Gain nodes (created in _init)
    this.masterGain = null;
    this.sfxGain    = null;
    this.musicGain  = null;
  }

  // ── Lazy init (must follow a user gesture) ────────────────────────────────

  _init() {
    if (this._ready) return;
    this._ready = true;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master chain with a soft limiter
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value     = 8;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.15;
    comp.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(comp);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.20;
    this.musicGain.connect(this.masterGain);

    // Pre-generate a 2-second noise buffer — reused by all drum/noise hits
    const sr  = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, sr * 2, sr);
    const nd = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  // ── Generic synthesis helpers ─────────────────────────────────────────────

  /**
   * Play a single oscillator tone with optional frequency sweep.
   */
  _osc(freq, type, when, dur, peak, dest, freqEnd = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, freqEnd), when + dur);
    }
    osc.connect(g);
    g.connect(dest);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.005);
    g.gain.linearRampToValueAtTime(0, when + dur);
    osc.start(when);
    osc.stop(when + dur + 0.01);
  }

  /**
   * Play a filtered burst from the pre-built noise buffer.
   * @param {'highpass'|'bandpass'|'lowpass'} filterType
   */
  _noise(filterFreq, filterType, when, dur, peak, dest) {
    const ctx    = this.ctx;
    const sr     = ctx.sampleRate;
    const frames = Math.min(Math.ceil(sr * dur), this._noiseBuf.length - 1);
    const off    = Math.floor(Math.random() * (this._noiseBuf.length - frames));

    const buf  = ctx.createBuffer(1, frames, sr);
    const src0 = this._noiseBuf.getChannelData(0);
    const dst  = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) dst[i] = src0[off + i];

    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const flt  = ctx.createBiquadFilter();
    flt.type   = filterType;
    flt.frequency.value = filterFreq;
    flt.Q.value = filterType === 'bandpass' ? 1.0 : 0.7;
    const g = ctx.createGain();
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    g.gain.setValueAtTime(peak, when);
    g.gain.linearRampToValueAtTime(0, when + dur);
    src.start(when);
    src.stop(when + dur + 0.01);
  }

  // ── Sound effects ─────────────────────────────────────────────────────────

  playJump() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(260, 'square', t, 0.13, 0.30, this.sfxGain, 580);
  }

  playAirJump() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(460, 'square',   t,       0.09, 0.22, this.sfxGain, 860);
    this._osc(700, 'triangle', t + 0.03, 0.08, 0.14, this.sfxGain, 1040);
  }

  playLand() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(110, 'sine', t, 0.09, 0.42, this.sfxGain, 32);
    this._noise(400, 'bandpass', t, 0.07, 0.18, this.sfxGain);
  }

  playDash() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(340, 'sawtooth', t, 0.14, 0.20, this.sfxGain, 80);
    this._noise(1800, 'highpass', t, 0.10, 0.10, this.sfxGain);
  }

  playMeleeSwing() {
    this._init();
    const t = this.ctx.currentTime;
    this._noise(1100, 'bandpass', t, 0.14, 0.28, this.sfxGain);
    this._osc(180, 'sawtooth', t, 0.08, 0.08, this.sfxGain, 90);
  }

  playMeleeHit() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(200, 'square',   t,        0.11, 0.28, this.sfxGain, 100);
    this._osc(440, 'square',   t + 0.01, 0.09, 0.20, this.sfxGain, 180);
    this._noise(700, 'bandpass', t, 0.09, 0.30, this.sfxGain);
  }

  playProjFire() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(950, 'sawtooth', t, 0.09, 0.18, this.sfxGain, 340);
  }

  playProjHit() {
    this._init();
    const t = this.ctx.currentTime;
    this._osc(750, 'square',   t, 0.16, 0.25, this.sfxGain, 130);
    this._noise(900, 'bandpass', t, 0.10, 0.20, this.sfxGain);
  }

  playDeath() {
    this._init();
    const t    = this.ctx.currentTime;
    const seq  = [440, 392, 349, 311, 277, 220, 196, 155];
    seq.forEach((f, i) => this._osc(f, 'square', t + i * 0.078, 0.10, 0.24, this.sfxGain));
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  startMusic() {
    this._init();
    if (this._musicOn) return;
    this._musicOn    = true;
    this._nextBarTime = this.ctx.currentTime + 0.06;
    this._barIndex    = 0;
    this._musicTick();
  }

  stopMusic() {
    this._musicOn = false;
    clearTimeout(this._schedHandle);
  }

  _musicTick() {
    if (!this._musicOn) return;
    const BPM = 128;
    const bar = (60 / BPM) * 4;   // one bar in seconds

    // Schedule bars until we have enough buffered ahead
    while (this._nextBarTime < this.ctx.currentTime + this._lookahead + bar) {
      this._playBar(this._nextBarTime, this._barIndex % 8);
      this._nextBarTime += bar;
      this._barIndex++;
    }
    this._schedHandle = setTimeout(() => this._musicTick(), 50);
  }

  /**
   * Schedule one bar of chiptune.
   * @param {number} t0       - AudioContext time for beat 1 of this bar
   * @param {number} barIdx   - Logical bar index 0–7 (determines pattern choice)
   */
  _playBar(t0, barIdx) {
    const BPM = 128;
    const s16 = (60 / BPM) / 4;    // 16th-note duration in seconds

    // ── Note table ─────────────────────────────────────────────────────────
    // A minor, rooted at A2 = 110 Hz.  Values are semitone offsets.
    const A2 = 110;
    const n  = (st) => A2 * Math.pow(2, st / 12);
    // Named notes for readability
    const [_, A2n, _B2, C3, D3, E3, _F3, G3,
           A3,  _B3, C4, D4, E4, _F4, G4,
           A4,  _B4, C5, _D5, E5] =
      [0,0,2,3,5,7,8,10,12,14,15,17,19,20,22,24,26,27,29,31].map(n);

    // ── Bass line patterns  (16 slots; null = rest) ──────────────────────
    const bassPatterns = [
      // Pattern 0: driving root
      [A2n,null,A2n,null, E3,null,A2n,null, A2n,null,G3,null, A2n,null,E3, null],
      // Pattern 1: movement
      [A2n,null,C3, null, E3,null,C3, null, D3, null,E3,null, G3, null,E3, null],
    ];

    // ── Melody patterns ──────────────────────────────────────────────────
    const melPatterns = [
      // A: simple hook
      [null,null,null,null, E4,null,G4, null, A4,  null,G4,null, E4,  null,null,null],
      // B: lower call
      [null,null,C4, null,  E4,null,C4, null, null,null,A3,null, C4,  null,E4,  null],
      // C: ascending arpeggio
      [A3,  C4,  E4, A4,   G4,  E4, C4, A3,   A3,  C4,  E4, G4,  E4,  D4, C4,  null],
      // D: high run
      [null,E4,  null,G4,  null,A4, null,C5,  null,A4, null,G4, E4,  null,D4,  null],
    ];

    const bassLine = bassPatterns[Math.floor(barIdx / 4) % 2];
    const melLine  = melPatterns[barIdx % 4];

    for (let i = 0; i < 16; i++) {
      const t = t0 + i * s16;

      // Bass (square, punchy)
      if (bassLine[i] != null) {
        this._osc(bassLine[i], 'square', t, s16 * 1.6, 0.42, this.musicGain);
      }

      // Melody (square, one octave up from pattern for brightness)
      if (melLine[i] != null) {
        this._osc(melLine[i], 'square', t, s16 * 0.75, 0.28, this.musicGain);
      }

      // Hi-hat: every even 16th note
      if (i % 2 === 0) {
        this._noise(7500, 'highpass', t, s16 * 0.32, 0.065, this.musicGain);
      }

      // Open hi-hat on offbeats (positions 2, 6, 10, 14)
      if (i % 4 === 2) {
        this._noise(5500, 'highpass', t, s16 * 0.85, 0.048, this.musicGain);
      }

      // Kick: beats 1 and 3 (positions 0 and 8)
      if (i === 0 || i === 8) {
        this._osc(155, 'sine', t, s16 * 2.2, 0.58, this.musicGain, 36);
      }

      // Snare: beats 2 and 4 (positions 4 and 12)
      if (i === 4 || i === 12) {
        this._noise(1800, 'bandpass', t, 0.11, 0.15, this.musicGain);
        this._osc(220, 'triangle', t, 0.09, 0.12, this.musicGain, 95);
      }

      // Extra arpeggio accent on bar patterns 2 and 6
      if ((barIdx === 2 || barIdx === 6) && i % 4 === 2) {
        const accent = [E4, G4, A4, C5][Math.floor(i / 4)];
        this._osc(accent, 'triangle', t, s16 * 0.6, 0.16, this.musicGain);
      }
    }
  }
}

// Global singleton — referenced by game.js
const SFX = new SoundEngine();
