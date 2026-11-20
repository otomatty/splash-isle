/**
 * 効果音と BGM。音声ファイルは使わず、すべて Web Audio で合成する。
 * ブラウザの制約上、最初のユーザー操作のあとで start() を呼ぶ。
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private sprayGain: GainNode | null = null;
  private hoverGain: GainNode | null = null;
  private hoverOsc: OscillatorNode | null = null;
  private timer = 0;
  private nextNote = 0;
  private stepIndex = 0;
  private musicOn = false;
  volume = 0.8;
  musicVolume = 0.6;

  get ready(): boolean {
    return this.ctx !== null;
  }

  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume * 0.5;
    this.music.connect(this.master);

    // ホワイトノイズ（水音・シェイカー・波に使い回す）
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startLoops();
    this.startMusic();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.music.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.1);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noise(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    s.loopStart = Math.random();
    return s;
  }

  private startLoops(): void {
    const ctx = this.ctx!;
    // 噴射音: 帯域ノイズ
    const sn = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300;
    bp.Q.value = 0.7;
    this.sprayGain = ctx.createGain();
    this.sprayGain.gain.value = 0;
    sn.connect(bp).connect(this.sprayGain).connect(this.sfx);
    sn.start();
    // ホバー音: 低いうなり＋ノイズ
    const hn = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.9;
    this.hoverGain = ctx.createGain();
    this.hoverGain.gain.value = 0;
    hn.connect(lp).connect(this.hoverGain);
    this.hoverOsc = ctx.createOscillator();
    this.hoverOsc.type = 'sawtooth';
    this.hoverOsc.frequency.value = 92;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    const olp = ctx.createBiquadFilter();
    olp.type = 'lowpass';
    olp.frequency.value = 420;
    this.hoverOsc.connect(olp).connect(og).connect(this.hoverGain);
    this.hoverGain.connect(this.sfx);
    hn.start();
    this.hoverOsc.start();
    // 波の音: ゆっくり満ち引きするノイズ
    const wn = this.noise();
    const wl = ctx.createBiquadFilter();
    wl.type = 'lowpass';
    wl.frequency.value = 520;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.035;
    lfo.connect(lg).connect(wg.gain);
    wn.connect(wl).connect(wg).connect(this.master);
    wn.start();
    lfo.start();
  }

  /** 噴射・ホバーの持続音の強さを毎フレーム指定する */
  setContinuous(spray: boolean, hover: boolean, hoverLeft: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sprayGain!.gain.setTargetAtTime(spray ? 0.16 : 0, t, 0.04);
    this.hoverGain!.gain.setTargetAtTime(hover ? 0.2 : 0, t, 0.05);
    if (hover) this.hoverOsc!.frequency.setTargetAtTime(70 + hoverLeft * 40, t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo = 0, dest: AudioNode | null = null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private burst(dur: number, gain: number, freq: number, q: number, type: BiquadFilterType = 'bandpass', when = 0, slideTo = 0, dest: AudioNode | null = null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const n = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(f).connect(g).connect(dest ?? this.sfx);
    n.start(t0, Math.random());
    n.stop(t0 + dur + 0.05);
  }

  jump(strength = 1): void {
    this.tone(330 * strength, 0.16, 'sine', 0.22, 0, 700 * strength);
    this.tone(660, 0.1, 'triangle', 0.05, 0.02, 1100);
  }
  land(strength: number): void {
    this.burst(0.12, 0.2 * strength + 0.05, 240, 0.8, 'lowpass', 0, 90);
  }
  step(kind: number): void {
    if (kind === 2) this.burst(0.09, 0.07, 1500, 1.2, 'bandpass', 0, 700);
    else if (kind === 3) this.burst(0.11, 0.08, 500, 2, 'bandpass', 0, 250);
    else this.burst(0.045, 0.045, 900 + Math.random() * 500, 1.5, 'bandpass');
  }
  splash(strength: number): void {
    this.burst(0.5, 0.3 * strength, 1800, 0.6, 'lowpass', 0, 350);
    this.burst(0.25, 0.14 * strength, 3200, 1, 'bandpass', 0.03, 1200);
  }
  shell(combo: number): void {
    const f = 1175 * Math.pow(2, Math.min(combo, 8) / 12);
    this.tone(f, 0.12, 'triangle', 0.16);
    this.tone(f * 1.5, 0.22, 'triangle', 0.14, 0.06);
  }
  star(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.16, i * 0.07));
  }
  gem(): void {
    // ヒカリ石のファンファーレ
    const seq: [number, number, number][] = [[523, 0, 0.16], [659, 0.12, 0.16], [784, 0.24, 0.16], [1047, 0.36, 0.3], [988, 0.68, 0.14], [1047, 0.82, 0.14], [1319, 0.96, 0.9]];
    for (const [f, w, d] of seq) {
      this.tone(f, d + 0.12, 'triangle', 0.2, w);
      this.tone(f / 2, d + 0.12, 'sine', 0.14, w);
      this.tone(f * 2, d, 'sine', 0.04, w);
    }
    [262, 330, 392].forEach((f) => this.tone(f, 1.4, 'sine', 0.07, 0.96));
    this.burst(0.9, 0.05, 6000, 0.5, 'highpass', 0.96);
  }
  reveal(): void {
    [659, 784, 988, 1319, 1568].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.12, i * 0.09));
  }
  hurt(): void {
    this.tone(420, 0.25, 'square', 0.12, 0, 110);
    this.burst(0.15, 0.1, 700, 1, 'bandpass');
  }
  enemyHit(): void {
    this.burst(0.05, 0.05, 1900 + Math.random() * 900, 3, 'bandpass');
  }
  enemyHop(): void {
    this.tone(150, 0.12, 'sine', 0.07, 0, 260);
  }
  enemyPop(): void {
    this.tone(300, 0.18, 'sine', 0.22, 0, 900);
    this.burst(0.25, 0.18, 1200, 0.8, 'bandpass', 0.02, 300);
    this.tone(1319, 0.25, 'triangle', 0.1, 0.1);
  }
  empty(): void {
    this.tone(210, 0.07, 'square', 0.07);
    this.tone(170, 0.09, 'square', 0.07, 0.09);
  }
  talk(): void {
    for (let i = 0; i < 3; i++) this.tone(520 + Math.random() * 260, 0.06, 'triangle', 0.07, i * 0.07);
  }
  ui(): void {
    this.tone(880, 0.07, 'triangle', 0.1);
  }
  clean(): void {
    this.tone(1760 + Math.random() * 500, 0.05, 'sine', 0.018);
  }

  // ───────────── BGM: 島のマリンバ（オリジナルの進行とフレーズを自動演奏）─────────────
  private startMusic(): void {
    if (this.musicOn) return;
    this.musicOn = true;
    this.nextNote = this.ctx!.currentTime + 0.3;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  private mallet(freq: number, when: number, gain: number, dur = 0.5): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(gain * 0.3, when);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    o.connect(g).connect(this.music);
    o2.connect(g2).connect(this.music);
    o.start(when); o2.start(when);
    o.stop(when + dur + 0.05); o2.stop(when + 0.15);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const spb = 60 / 108 / 4; // 16分音符の長さ
    // コード進行（8小節）: C  Am  F  G  /  C  Em  F  G
    const chords = [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2], [0, 4, 7], [4, 7, 11], [5, 9, 0], [7, 11, 2]];
    const roots = [0, 9, 5, 7, 0, 4, 5, 7];
    // メロディ（16分音符×16×8小節。-1 は休符。ペンタトニック中心の跳ねるフレーズ）
    const mel = [
      12, -1, -1, 16, -1, 19, -1, -1, 21, -1, 19, -1, 16, -1, -1, -1,
      21, -1, -1, 24, -1, 21, -1, 19, -1, -1, 16, -1, 19, -1, -1, -1,
      17, -1, -1, 21, -1, 24, -1, -1, 26, -1, 24, -1, 21, -1, 19, -1,
      19, -1, 23, -1, 26, -1, -1, 23, -1, -1, 19, -1, 14, -1, -1, -1,
      24, -1, -1, 19, -1, 16, -1, -1, 19, -1, 24, -1, 28, -1, -1, -1,
      28, -1, 26, -1, 23, -1, -1, 19, -1, -1, 23, -1, 26, -1, -1, -1,
      29, -1, -1, 28, -1, 24, -1, -1, 21, -1, 24, -1, 21, -1, 17, -1,
      19, -1, 21, -1, 23, -1, 26, -1, 31, -1, -1, -1, -1, -1, 19, -1,
    ];
    const hz = (semi: number) => 261.63 * Math.pow(2, semi / 12);
    while (this.nextNote < ctx.currentTime + 0.35) {
      const i = this.stepIndex % 128;
      const bar = Math.floor(i / 16), s = i % 16;
      const swing = s % 2 === 1 ? spb * 0.16 : 0;
      const t = this.nextNote + swing;
      // ベース
      if (s === 0 || s === 6 || s === 10) this.mallet(hz(roots[bar] - 24) * (s === 10 ? 1.5 : 1), t, 0.34, 0.42);
      // 伴奏の刻み（裏拍）
      if (s === 4 || s === 12 || s === 7 || s === 14) {
        for (const n of chords[bar]) this.mallet(hz(n), t, 0.075, 0.22);
      }
      // メロディ
      const m = mel[i];
      if (m >= 0) this.mallet(hz(m), t, 0.2, 0.5);
      // シェイカー
      const acc = s % 4 === 2 ? 0.05 : s % 2 === 0 ? 0.025 : 0.015;
      this.burst(0.04, acc, 7000, 0.8, 'highpass', t - ctx.currentTime, 0, this.music);
      // ウッドブロック風のアクセント
      if (s === 4 || s === 12) this.burst(0.05, 0.05, 1900, 6, 'bandpass', t - ctx.currentTime, 0, this.music);
      this.nextNote += spb;
      this.stepIndex++;
    }
  }

  stopMusic(): void {
    window.clearInterval(this.timer);
    this.musicOn = false;
  }
}
