// 生成音楽エンジン: 表情で調性が変わり、目覚めた輪の数だけ楽器が重なる

const MODES = {
  bright: { scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], penta: [0, 1, 2, 4, 5] },
  mid: { scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 6, 4], penta: [0, 2, 3, 4, 6] },
  dark: { scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 5, 1, 4], penta: [0, 2, 3, 4, 6] },
};
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
// 層ごとの残響・ディレイ送り量 [rev, del]
const SENDS = [[.1, 0], [.3, .45], [.05, 0], [.15, .1], [.7, .4], [.8, 0], [.9, .5]];

export class Sound {
  constructor() {
    this.layers = Array(7).fill(false);
    this.events = [];
    this.root = 50; this.mode = 'mid'; this.deg = 0;
    this.val = 0; this.brow = 0; this.gx = 0; this.gy = 0; this.energy = 0;
    this.climax = false; this.bpm = 94; this.walk = 5; this.stepN = 0;
    this.ready = false; this.muted = false; this.tempoMul = 1;
  }

  start(ctx) {
    const C = this.ctx = ctx;
    this.master = C.createGain(); this.master.gain.value = .85;
    this.lp = C.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 5000; this.lp.Q.value = .5;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = .005; comp.release.value = .2;
    this.bus = C.createGain();
    this.bus.connect(this.lp).connect(comp).connect(this.master).connect(C.destination);
    this.an = C.createAnalyser(); this.an.fftSize = 256; this.master.connect(this.an);
    this.anBuf = new Uint8Array(this.an.frequencyBinCount);

    // 残響
    const len = Math.floor(C.sampleRate * 3.4), ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    const rev = C.createConvolver(); rev.buffer = ir;
    this.revIn = C.createGain(); const revOut = C.createGain(); revOut.gain.value = .55;
    this.revIn.connect(rev).connect(revOut).connect(this.bus);
    // ディレイ
    this.delIn = C.createGain(); this.delay = C.createDelay(2); this.delay.delayTime.value = 60 / this.bpm * .75;
    const fb = C.createGain(); fb.gain.value = .42; const dOut = C.createGain(); dOut.gain.value = .5;
    this.delIn.connect(this.delay); this.delay.connect(fb).connect(this.delay);
    this.delay.connect(dOut).connect(this.bus); dOut.connect(this.revIn);
    // ノイズ
    const nb = this.noise = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // 層バス
    this.L = SENDS.map(([r, d]) => {
      const g = C.createGain(); g.gain.value = 0; g.connect(this.bus);
      const gr = C.createGain(); gr.gain.value = r; g.connect(gr).connect(this.revIn);
      const gd = C.createGain(); gd.gain.value = d; g.connect(gd).connect(this.delIn);
      return g;
    });
    this.fx = C.createGain(); this.fx.connect(this.bus);
    const fr = C.createGain(); fr.gain.value = .7; this.fx.connect(fr).connect(this.revIn);
    const fd = C.createGain(); fd.gain.value = .25; this.fx.connect(fd).connect(this.delIn);

    // ドローン(常時)
    this.droneF = C.createBiquadFilter(); this.droneF.type = 'lowpass'; this.droneF.frequency.value = 380; this.droneF.Q.value = 2;
    const dg = C.createGain(); dg.gain.value = 0; dg.gain.setTargetAtTime(.13, C.currentTime, 2);
    this.droneF.connect(dg).connect(this.fx);
    this.drone = [['sawtooth', 0], ['sawtooth', 9], ['sine', 0], ['sawtooth', -6]].map(([type, det]) => {
      const o = C.createOscillator(); o.type = type; o.detune.value = det; o.connect(this.droneF); o.start(); return o;
    });

    // 合唱(層5)
    const cf1 = this.cf1 = C.createBiquadFilter(), cf2 = this.cf2 = C.createBiquadFilter();
    cf1.type = cf2.type = 'bandpass'; cf1.Q.value = 5; cf2.Q.value = 7; cf1.frequency.value = 500; cf2.frequency.value = 1000;
    const cg = C.createGain(); cg.gain.value = .5; cf1.connect(cg); cf2.connect(cg); cg.connect(this.L[5]);
    this.choir = [0, 1, 2, 3].map(i => {
      const g = C.createGain(); g.gain.value = .16; g.connect(cf1); g.connect(cf2);
      return [-8, 7].map(det => { const o = C.createOscillator(); o.type = 'sawtooth'; o.detune.value = det + i * 2; o.connect(g); o.start(); return o; });
    });

    // 声に寄り添うシンセ
    this.vG = C.createGain(); this.vG.gain.value = 0; this.vG.connect(this.fx);
    this.vOsc = [['sine', 1, .5], ['triangle', 2, .22], ['sine', 1.4983, .2]].map(([type, mul, vol]) => {
      const o = C.createOscillator(); o.type = type; const g = C.createGain(); g.gain.value = vol;
      o.connect(g).connect(this.vG); o.start(); return { o, mul };
    });
    // 風(口をすぼめる)
    const ws = C.createBufferSource(); ws.buffer = nb; ws.loop = true;
    this.windF = C.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 14; this.windF.frequency.value = 900;
    this.windG = C.createGain(); this.windG.gain.value = 0;
    ws.connect(this.windF).connect(this.windG).connect(this.fx); ws.start();

    this._chord(C.currentTime);
    this.nextT = C.currentTime + .1;
    this.timer = setInterval(() => this._tick(), 25);
    this.ready = true;
  }

  note(d, oct) {
    const sc = MODES[this.mode].scale;
    return this.root + 12 * oct + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  }
  quantize(m) {
    const sc = MODES[this.mode].scale; let best = m, bd = 99;
    for (let o = -2; o <= 4; o++) for (const s of sc) { const c = this.root + 12 * o + s, d = Math.abs(c - m); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  on(i) { return this.layers[i] || this.climax; }

  setLayer(i, on) {
    this.layers[i] = on;
    if (!this.ready) return;
    this.L[i].gain.setTargetAtTime(this.on(i) ? 1 : 0, this.ctx.currentTime, on ? .15 : .5);
  }
  setClimax(b) {
    this.climax = b;
    if (!this.ready) return;
    this.L.forEach((g, i) => g.gain.setTargetAtTime(this.on(i) ? 1 : 0, this.ctx.currentTime, b ? .1 : 1.2));
  }
  setRoot(r) { this.root = r; }
  setMute(m) { this.muted = m; if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : .85, this.ctx.currentTime, .05); }

  // 毎フレームの連続制御
  update(s, energy, val, climaxAmt) {
    if (!this.ready) return;
    const C = this.ctx, t = C.currentTime;
    this.val = val; this.brow = s.brow; this.gx = s.gx; this.gy = s.gy; this.energy = energy;
    this.bpm = (92 + Math.min(1, energy) * 10 + climaxAmt * 10) * this.tempoMul;
    this.delay.delayTime.setTargetAtTime(60 / this.bpm * .75, t, .3);
    const open = Math.max(s.jaw, s.vol * .7, climaxAmt);
    this.lp.frequency.setTargetAtTime(2600 + 13000 * open + Math.max(0, val) * 2500, t, .08);
    this.droneF.frequency.setTargetAtTime(300 + 900 * open + 250 * Math.max(0, val), t, .15);
    // 母音フォルマント: 閉=う / 開=あ
    this.cf1.frequency.setTargetAtTime(360 + 480 * s.jaw, t, .08);
    this.cf2.frequency.setTargetAtTime(820 + 480 * s.jaw + 900 * Math.max(0, val), t, .08);
    // 声
    if (s.pitch > 0 && s.vol > .05) {
      const f = mtof(this.quantize(69 + 12 * Math.log2(s.pitch / 440)) + 12);
      for (const v of this.vOsc) v.o.frequency.setTargetAtTime(f * v.mul, t, .035);
      this.vG.gain.setTargetAtTime(Math.min(.3, s.vol * .4), t, .05);
    } else this.vG.gain.setTargetAtTime(0, t, .18);
    // 風
    this.windF.frequency.setTargetAtTime(700 * Math.pow(2, (s.gy + 1) * 1.1), t, .06);
    this.windG.gain.setTargetAtTime(Math.max(0, s.pucker - .35) * 1.6, t, .08);
    this.an.getByteFrequencyData(this.anBuf);
    let lv = 0; for (let i = 0; i < 8; i++) lv += this.anBuf[i]; this.level = lv / (8 * 255);
  }

  poll() {
    if (!this.ready || !this.events.length) return [];
    const now = this.ctx.currentTime, out = [];
    this.events = this.events.filter(e => (e.t <= now ? (out.push(e), false) : true));
    return out;
  }

  _tick() {
    const C = this.ctx;
    if (C.state !== 'running') return;
    if (this.nextT < C.currentTime - .5) this.nextT = C.currentTime + .05;
    while (this.nextT < C.currentTime + .12) {
      this._step(this.stepN, this.nextT);
      const d = 60 / this.bpm / 4, sw = .08;
      this.nextT += d * (this.stepN % 2 === 0 ? 1 + sw : 1 - sw);
      this.stepN++;
    }
  }

  _chord(t) {
    const d = this.deg;
    const r = mtof(this.note(d, -1));
    this.drone[0].frequency.setTargetAtTime(r, t, .25);
    this.drone[1].frequency.setTargetAtTime(r * 1.5, t, .25);
    this.drone[2].frequency.setTargetAtTime(r / 2, t, .25);
    this.drone[3].frequency.setTargetAtTime(r * 2, t, .25);
    [0, 2, 4, 6].forEach((k, i) => {
      const f = mtof(this.note(d + k, 1));
      for (const o of this.choir[i]) o.frequency.setTargetAtTime(f, t, .2);
    });
  }

  _step(n, t) {
    const s = n % 16, bar = n >> 4, cl = this.climax;
    if (s === 0) {
      const v = this.val;
      if (v > .25) this.mode = 'bright'; else if (v < -.25) this.mode = 'dark'; else if (Math.abs(v) < .12) this.mode = 'mid';
      this.deg = MODES[this.mode].prog[bar % 4];
      this._chord(t);
      this.events.push({ t, type: 'bar' });
    }
    const M = MODES[this.mode], deg = this.deg, rnd = Math.random;
    // 0: ベース
    if (this.on(0) && (this.mode === 'dark' ? [0, 3, 8, 11] : [0, 6, 10]).includes(s)) {
      this._pluck(t, mtof(this.note(deg, -1)), { dur: .5, vol: .34, type: 'sawtooth', cut: 420 }, this.L[0]);
      this.events.push({ t, type: 'note', layer: 0 });
    }
    // 1: アルペジオ(眉で駆け上がる)
    const fast = this.brow > .45 || cl;
    if (this.on(1) && (fast || s % 2 === 0)) {
      const pat = [0, 2, 4, 6, 7, 4, 2, 4], k = fast ? n : n >> 1;
      const f = mtof(this.note(deg + pat[k % 8], 1 + (this.brow > .45 ? 1 : 0)));
      this._pluck(t, f, { dur: .28, vol: .15, pan: this.gx * .8, type: 'triangle', cut: 1800 + this.energy * 1500 }, this.L[1]);
      this.events.push({ t, type: 'note', layer: 1 });
    }
    // 2: 鼓動
    if (this.on(2) && (s % 8 === 0 || (cl && s % 4 === 0) || (s === 14 && rnd() < .3))) {
      this._kick(t); this.events.push({ t, type: 'kick' }, { t, type: 'note', layer: 2 });
    }
    // 3: 粒
    if (this.on(3) && (s % 4 === 2 || (s % 2 === 1 && rnd() < .25 + this.energy * .4))) {
      this._hat(t, s % 4 === 2 ? .11 : .05); this.events.push({ t, type: 'note', layer: 3 });
    }
    // 4: 鐘の旋律(視線の高さで音域が変わる)
    if (this.on(4) && s % 2 === 0 && rnd() < (cl ? .6 : .38)) {
      this.walk = Math.max(0, Math.min(11, this.walk + Math.floor(rnd() * 5) - 2));
      const d = M.penta[this.walk % 5] + 7 * Math.floor(this.walk / 5);
      this._bell(t, mtof(this.note(d, 2 + (this.gy > .3 ? 1 : 0))), .1, (rnd() - .5) * 1.2, this.L[4]);
      this.events.push({ t, type: 'note', layer: 4 });
    }
    // 5: 合唱(持続音。小節頭で脈動だけ知らせる)
    if (this.on(5) && s === 0) this.events.push({ t, type: 'note', layer: 5 });
    // 6: きらめきと低音
    if (this.on(6)) {
      if (s === 0) this._sub(t, mtof(this.note(deg, -2)), 60 / this.bpm * 3.6);
      if (s % 4 === 0 && rnd() < .55) {
        const f = mtof(this.note(deg + [0, 2, 4][Math.floor(rnd() * 3)], 3 + Math.floor(rnd() * 2)));
        this._pluck(t, f, { dur: 1.4, vol: .035, pan: (rnd() - .5) * 1.6, type: 'sine', cut: 6000, att: .08 }, this.L[6]);
        this.events.push({ t, type: 'note', layer: 6 });
      }
    }
  }

  // ---- 音色 ----
  _pluck(t, f, { dur = .25, vol = .2, pan = 0, type = 'triangle', cut = 2400, att = .005 }, dest) {
    const C = this.ctx, o = C.createOscillator(), fl = C.createBiquadFilter(), g = C.createGain(), p = C.createStereoPanner();
    o.type = type; o.frequency.value = f;
    fl.type = 'lowpass'; fl.Q.value = 4;
    fl.frequency.setValueAtTime(Math.min(16000, cut * 3), t); fl.frequency.exponentialRampToValueAtTime(Math.max(80, cut * .5), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(fl).connect(g).connect(p).connect(dest); o.start(t); o.stop(t + dur + .05);
  }
  _bell(t, f, vol, pan, dest, dur = 2.6) {
    const C = this.ctx, c = C.createOscillator(), m = C.createOscillator(), mg = C.createGain(), g = C.createGain(), p = C.createStereoPanner();
    c.frequency.value = f; m.frequency.value = f * 3.51;
    mg.gain.setValueAtTime(f * 1.8, t); mg.gain.exponentialRampToValueAtTime(f * .05, t + .7);
    m.connect(mg).connect(c.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .004); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    p.pan.value = Math.max(-1, Math.min(1, pan));
    c.connect(g).connect(p).connect(dest); c.start(t); m.start(t); c.stop(t + dur + .05); m.stop(t + dur + .05);
  }
  _kick(t) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(.8, t); g.gain.exponentialRampToValueAtTime(.001, t + .4);
    o.connect(g).connect(this.L[2]); o.start(t); o.stop(t + .45);
  }
  _noise(t, { dur, vol, type = 'highpass', f0, f1, q = 1, att = .002 }, dest) {
    const C = this.ctx, s = C.createBufferSource(), fl = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.noise; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    s.connect(fl).connect(g).connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05);
  }
  _hat(t, vol) { this._noise(t, { dur: .06, vol, f0: 7500 }, this.L[3]); }
  _sub(t, f, dur) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .3); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.L[6]); o.start(t); o.stop(t + dur + .05);
  }

  // ---- 出来事 ----
  get now() { return this.ctx.currentTime + .01; }
  awaken(i) {
    if (!this.ready) return;
    const t = this.now;
    [0, 2, 4, 7].forEach((k, j) => this._bell(t + j * .08, mtof(this.note(this.deg + k, 2)), .12, (i / 6 - .5) * 1.4, this.fx, 3));
  }
  blink() {
    if (!this.ready) return;
    const t = this.now;
    this._pluck(t, mtof(this.note(this.deg + 4, 3)), { dur: .12, vol: .1, type: 'sine', cut: 5000 }, this.fx);
    this._noise(t, { dur: .03, vol: .05, f0: 5000 }, this.fx);
  }
  wink(side) {
    if (!this.ready) return;
    const M = MODES[this.mode], d = M.penta[Math.floor(Math.random() * 5)];
    this._bell(this.now, mtof(this.note(d, 3)), .1, side * .8, this.fx, 2);
  }
  gong() {
    if (!this.ready) return;
    const t = this.now;
    this._bell(t, mtof(this.note(this.deg, -1)), .3, 0, this.fx, 5);
    this._bell(t, mtof(this.note(this.deg + 4, 0)), .12, 0, this.fx, 4);
    this._noise(t, { dur: .9, vol: .16, type: 'bandpass', f0: 300, f1: 3500, q: 1.5, att: .25 }, this.fx);
  }
  burst() {
    if (!this.ready) return;
    const t = this.now;
    this._noise(t, { dur: .5, vol: .14, f0: 3000 }, this.fx);
    [0, 2, 4].forEach((k, j) => this._bell(t + j * .03, mtof(this.note(this.deg + k, 3)), .07, (j - 1) * .7, this.fx, 2));
  }
  gust() {
    if (!this.ready) return;
    this._noise(this.now, { dur: 2.2, vol: .22, type: 'bandpass', f0: 400, f1: 2600, q: 2.5, att: .7 }, this.fx);
  }
  surf() {
    if (!this.ready) return;
    const t = this.now;
    for (let j = 0; j < 3; j++) this._noise(t + j * 1.15, { dur: 1.7, vol: .2, type: 'lowpass', f0: 280, f1: 1500, q: .7, att: .75 }, this.fx);
  }
  swell() {
    if (!this.ready) return;
    this._noise(this.now, { dur: 1.2, vol: .07, type: 'bandpass', f0: 2500, f1: 7000, q: 1.2, att: .4 }, this.fx);
  }
  rumble() {
    if (!this.ready) return;
    const C = this.ctx, t = this.now, o = C.createOscillator(), g = C.createGain();
    o.frequency.setValueAtTime(mtof(this.note(this.deg, -2)) * 2, t); o.frequency.exponentialRampToValueAtTime(mtof(this.note(this.deg, -2)), t + .8);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .25); g.gain.exponentialRampToValueAtTime(.001, t + 1.4);
    o.connect(g).connect(this.fx); o.start(t); o.stop(t + 1.5);
  }
  sparkle() {
    if (!this.ready) return;
    const t = this.now, M = MODES[this.mode];
    for (let j = 0; j < 9; j++) this._bell(t + j * .07, mtof(this.note(M.penta[j % 5] + 7 * Math.floor(j / 5), 2)), .08, Math.sin(j * 1.7) * .9, this.fx, 3);
  }
  chordBell(up) {
    if (!this.ready) return;
    const t = this.now;
    (up ? [0, 2, 4] : [4, 2, 0]).forEach((k, j) => this._bell(t + j * .12, mtof(this.note(this.deg + k, up ? 2 : 1)), .11, 0, this.fx, 3));
  }
  bloom() {
    if (!this.ready) return;
    const t = this.now;
    this._noise(t, { dur: 2.5, vol: .2, type: 'bandpass', f0: 200, f1: 9000, q: .8, att: 1.6 }, this.fx);
    for (let j = 0; j < 12; j++) this._bell(t + 1.6 + j * .09, mtof(this.note(j * 2, 1)), .09, Math.sin(j) * .9, this.fx, 4);
  }
}
