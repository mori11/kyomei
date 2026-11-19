// センシング: カメラ(視線・表情) と マイク(声量・音高・声色)。すべて端末内で処理する。

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const GMODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const SIM_GEST = { 1: 'Open_Palm', 2: 'Closed_Fist', 3: 'Pointing_Up', 4: 'Victory', 5: 'Thumb_Up', 6: 'Thumb_Down', 7: 'ILoveYou' };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// 視線合わせで順に見つめる9点。画面端を1とした位置。中央から始めて外周をひと回りする
const CAL_PTS = [[0, 0], [-.75, .7], [0, .7], [.75, .7], [.75, 0], [.75, -.7], [0, -.7], [-.75, -.7], [-.75, 0]];
// 視線の計算式: 画面位置 = 重み×特徴 + 定数。特徴は [頭の左右, 目の左右] と [頭の上下, 目の上下(虹彩), 目の上下(まぶた)]
// 特徴はおおよその動き幅で割って大きさを揃えてある。下は測定前に使う標準の重み
const FSCALE = [.08, .06, .06, .04, .25];
const MODEL_DEF = { wx: [-.36, -.54], bx: 0, wy: [-.3, -.16, .225], by: 0, quality: '' };
const median = a => { const s = Float64Array.from(a).sort(); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
// 最小二乗法(リッジ回帰)。X: 行=測定点, 列=特徴。動いていない特徴に引きずられないよう lam で抑える
function ridge(X, y, lam) {
  const n = X.length, d = X[0].length, mx = Array(d).fill(0); let my = 0;
  for (let i = 0; i < n; i++) { my += y[i] / n; for (let j = 0; j < d; j++) mx[j] += X[i][j] / n; }
  const A = Array.from({ length: d }, (_, j) => Array.from({ length: d + 1 }, (_, k) => (k === j ? lam : 0)));
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) {
    const xj = X[i][j] - mx[j];
    for (let k = 0; k < d; k++) A[j][k] += xj * (X[i][k] - mx[k]);
    A[j][d] += xj * (y[i] - my);
  }
  for (let c = 0; c < d; c++) {
    let pv = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
    [A[c], A[pv]] = [A[pv], A[c]];
    if (Math.abs(A[c][c]) < 1e-9) continue;
    for (let r = 0; r < d; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let k = c; k <= d; k++) A[r][k] -= m * A[c][k]; }
  }
  const w = A.map((row, j) => (Math.abs(row[j]) < 1e-9 ? 0 : row[d] / row[j]));
  return { w, b: my - w.reduce((s, wj, j) => s + wj * mx[j], 0) };
}

class OneEuro {
  constructor(minCut = .45, beta = .9) { this.minCut = minCut; this.beta = beta; this.x = null; this.dx = 0; }
  reset() { this.x = null; }
  filter(x, dt) {
    if (this.x == null) { this.x = x; this.dx = 0; return x; }
    const a = c => 1 / (1 + 1 / (2 * Math.PI * c) / dt);
    const dx = (x - this.x) / dt;
    this.dx += (dx - this.dx) * a(1);
    this.x += (x - this.x) * a(this.minCut + this.beta * Math.abs(this.dx));
    return this.x;
  }
}

export class Sense {
  constructor() {
    this.state = {
      gx: 0, gy: 0, smile: 0, frown: 0, jaw: 0, brow: 0, blinkL: 0, blinkR: 0, pucker: 0, valence: 0,
      vol: 0, pitch: 0, bright: .5, hx: 0, hy: 0, hz: 0,
      face: false, mic: false, cam: false, calibrating: false, landmarks: null,
    };
    this.sens = 1;
    this.fx = new OneEuro(); this.fy = new OneEuro();
    this.model = { ...MODEL_DEF }; this.calib = null; this.off = { x: 0, y: 0 }; this.hx5 = []; this.hy5 = [];
    this.lastFace = -9; this.lastVT = -1;
    this.lm = new Float32Array(478 * 3);
    this.face = { gx: 0, gy: 0, smile: 0, frown: 0, jaw: 0, brow: 0, blinkL: 0, blinkR: 0, pucker: 0, hx: 0, hy: 0, hz: 0 };
    this.mouse = { x: 0, y: 0 }; this.keys = {}; this.sim = { smile: 0, frown: 0, jaw: 0, brow: 0, blink: 0, pucker: 0, vol: 0 };
    this.floor = .01; this.vol = 0; this.pitch = 0; this.pitchHold = 0;
    this.topology = null; this.bsIdx = null; this.handTopology = null;
    // 手: 位置は画面端を1とした座標。raw は21点の骨格
    this.hand = { on: false, gesture: 'None', x: 0, y: 0, raw: new Float32Array(42), hasRaw: false, miss: 0, cand: '', cnt: 0 };
    this.simHand = { on: false, gesture: 'None', x: 0, y: 0, raw: null, hasRaw: false };
    this.state.hand = this.hand;

    const mv = (x, y) => { this.mouse.x = x / innerWidth * 2 - 1; this.mouse.y = -(y / innerHeight * 2 - 1); };
    addEventListener('pointermove', e => mv(e.clientX, e.clientY));
    addEventListener('pointerdown', e => mv(e.clientX, e.clientY));
    addEventListener('keydown', e => { this.keys[e.key.toLowerCase()] = true; });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }

  async initMedia(ctx, video, onStatus = () => { }) {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) throw new Error('nomedia');
    const V = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, A = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
    let stream = null;
    try { stream = await md.getUserMedia({ video: V, audio: A }); }
    catch { try { stream = await md.getUserMedia({ video: V }); } catch { try { stream = await md.getUserMedia({ audio: A }); } catch { } } }
    if (!stream) throw new Error('nomedia');
    this.stream = stream;
    if (stream.getAudioTracks().length) {
      const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.an = ctx.createAnalyser(); this.an.fftSize = 2048; this.an.smoothingTimeConstant = .5;
      src.connect(this.an);
      this.tbuf = new Float32Array(2048); this.fbuf = new Uint8Array(1024);
      this.nsdf = new Float32Array(1024); this.sr = ctx.sampleRate;
      this.state.mic = true;
    }
    if (stream.getVideoTracks().length) {
      video.srcObject = new MediaStream(stream.getVideoTracks());
      await video.play();
      this.video = video;
      onStatus('顔認識モデルを読み込み中…');
      const { FaceLandmarker, FilesetResolver, GestureRecognizer } = await import(`${MP}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const opt = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, outputFaceBlendshapes: true, runningMode: 'VIDEO', numFaces: 1 });
      try { this.fl = await FaceLandmarker.createFromOptions(fileset, opt('GPU')); }
      catch { this.fl = await FaceLandmarker.createFromOptions(fileset, opt('CPU')); }
      this.topology = FaceLandmarker.FACE_LANDMARKS_TESSELATION || null;
      this.state.cam = true;
      this.calibrate();
      // 手の認識は裏で読み込む(顔の追跡を待たせない)
      this.handTopology = GestureRecognizer?.HAND_CONNECTIONS || null;
      if (GestureRecognizer) {
        const gopt = d => ({ baseOptions: { modelAssetPath: GMODEL, delegate: d }, runningMode: 'VIDEO', numHands: 1 });
        GestureRecognizer.createFromOptions(fileset, gopt('GPU'))
          .catch(() => GestureRecognizer.createFromOptions(fileset, gopt('CPU')))
          .then(g => { this.gr = g; }).catch(e => console.warn('gesture model unavailable', e));
      }
    }
  }

  stop() { this.stream?.getTracks().forEach(t => t.stop()); }
  calibrate() { this.calib = { step: 0, t: 0, buf: [[], [], [], [], []], pts: [] }; this.off.x = this.off.y = 0; this._resetFilters(); }
  _resetFilters() { this.fx.reset(); this.fy.reset(); this.hx5.length = 0; this.hy5.length = 0; }
  // 測定した9点から、その人の頭と目の動かし方に合った重みを求める
  _fit(pts) {
    const X1 = pts.map(p => [p.f[0], p.f[1]]), X2 = pts.map(p => [p.f[2], p.f[3], p.f[4]]);
    const rx = ridge(X1, pts.map(p => p.t[0]), .03), ry = ridge(X2, pts.map(p => p.t[1]), .03);
    const m = { wx: rx.w, bx: rx.b, wy: ry.w, by: ry.b };
    let e = 0;
    for (const p of pts) { const g = this._predict(m, p.f); e += (g[0] - p.t[0]) ** 2 + (g[1] - p.t[1]) ** 2; }
    const rms = Math.sqrt(e / pts.length / 2);
    if (rms > .32 || !isFinite(rms)) {
      // うまく測れなかったとき: 標準の重みのまま、中央だけ合わせる
      const g = this._predict(MODEL_DEF, pts[0].f);
      this.model = { ...MODEL_DEF, bx: -g[0], by: -g[1], quality: '粗い（C キーでやり直せます）', rms };
    } else this.model = { ...m, quality: rms < .1 ? '良好' : rms < .2 ? 'ふつう' : 'やや粗い', rms };
  }
  _predict(m, f) { return [m.wx[0] * f[0] + m.wx[1] * f[1] + m.bx, m.wy[0] * f[2] + m.wy[1] * f[3] + m.wy[2] * f[4] + m.by]; }
  // 輪を目覚めさせた瞬間は「そこを見ていた」と分かるので、ズレを少しずつ打ち消す
  nudge(ex, ey) { this.off.x = clamp(this.off.x + ex * .3, -.35, .35); this.off.y = clamp(this.off.y + ey * .3, -.35, .35); }

  _face(dt, now) {
    const v = this.video;
    if (!this.fl || v.readyState < 2 || v.currentTime === this.lastVT) return;
    const fdt = clamp(v.currentTime - this.lastVT, 1 / 120, .2);
    this.lastVT = v.currentTime;
    if (this.gr && (this._fc = (this._fc | 0) + 1) % 2 === 0) this._hand(v);
    let res; try { res = this.fl.detectForVideo(v, performance.now()); } catch { return; }
    const L = res.faceLandmarks?.[0], B = res.faceBlendshapes?.[0]?.categories;
    if (!L || !B) return;
    this.lastFace = now;
    if (!this.bsIdx) { this.bsIdx = {}; B.forEach((c, i) => { this.bsIdx[c.categoryName] = i; }); }
    const b = n => B[this.bsIdx[n]]?.score || 0;
    const f = this.face;
    // 表情
    f.smile = clamp((b('mouthSmileLeft') + b('mouthSmileRight')) / 2 * 1.25, 0, 1);
    f.frown = clamp(Math.max((b('mouthFrownLeft') + b('mouthFrownRight')) / 2 * 2.5, (b('browDownLeft') + b('browDownRight')) / 2 * 1.2 - f.smile * .6), 0, 1);
    f.jaw = clamp(b('jawOpen') * 1.3, 0, 1);
    f.brow = clamp(Math.max(b('browInnerUp'), (b('browOuterUpLeft') + b('browOuterUpRight')) / 2) * 1.3, 0, 1);
    f.pucker = b('mouthPucker');
    f.blinkL = b('eyeBlinkLeft'); f.blinkR = b('eyeBlinkRight');
    // 頭の向き: 鼻先が顔の中心からどれだけずれているか
    const nose = L[1], sr = L[234], sl = L[454], top = L[10], chin = L[152];
    const fw = Math.hypot(sl.x - sr.x, sl.y - sr.y) + 1e-6, fh = Math.hypot(chin.x - top.x, chin.y - top.y) + 1e-6;
    const cx = (sr.x + sl.x) / 2, cy = (top.y + chin.y) / 2;
    const hx = (nose.x - cx) / fw, hy = (nose.y - cy) / fh;
    // 目の向き: 虹彩が目の中でどこにあるか
    // まばたき中は目の値が大きく乱れるので、直前の値を保つ
    if (L.length > 473 && Math.max(f.blinkL, f.blinkR) < .4) {
      const w1 = Math.abs(L[133].x - L[33].x) + 1e-6, w2 = Math.abs(L[263].x - L[362].x) + 1e-6;
      this._ex = ((L[468].x - (L[33].x + L[133].x) / 2) / w1 + (L[473].x - (L[362].x + L[263].x) / 2) / w2) / 2;
      this._ey = ((L[468].y - (L[33].y + L[133].y) / 2) / w1 + (L[473].y - (L[362].y + L[263].y) / 2) / w2) / 2;
      this._ev = (b('eyeLookUpLeft') + b('eyeLookUpRight') - b('eyeLookDownLeft') - b('eyeLookDownRight')) / 2;
    }
    const blinking = Math.max(f.blinkL, f.blinkR) >= .4;
    const ft = [hx / FSCALE[0], (this._ex || 0) / FSCALE[1], hy / FSCALE[2], (this._ey || 0) / FSCALE[3], (this._ev || 0) / FSCALE[4]];
    if (this.calib) {
      const c = this.calib; c.t += fdt;
      if (c.t > .75 && !blinking) for (let i = 0; i < 5; i++) c.buf[i].push(ft[i]);
      if (c.t > 1.7 && c.buf[0].length > 8) {
        c.pts.push({ f: c.buf.map(median), t: CAL_PTS[c.step] }); c.step++; c.t = 0; c.buf = [[], [], [], [], []];
        if (c.step >= CAL_PTS.length) { this._fit(c.pts); this.calib = null; this._resetFilters(); }
      }
      f.gx = 0; f.gy = 0;
    } else {
      const g = this._predict(this.model, ft);
      // 直近5回の中央値で突発的な飛びを捨て、その後なめらかにする
      const a = this.hx5, c = this.hy5; a.push(g[0]); c.push(g[1]); if (a.length > 5) { a.shift(); c.shift(); }
      f.gx = this.fx.filter(clamp(median(a) * this.sens + this.off.x, -1.15, 1.15), fdt);
      f.gy = this.fy.filter(clamp(median(c) * this.sens + this.off.y, -1.15, 1.15), fdt);
    }
    // 頭の位置(視差用)
    f.hx = -(cx - .5) * 2; f.hy = -(cy - .5) * 2; f.hz = clamp((fw - .3) * 3, -1, 1);
    // 顔メッシュ(光の面)
    const va = (v.videoWidth || 640) / (v.videoHeight || 480), sc = 1.25 / fh, lm = this.lm, n = Math.min(478, L.length);
    for (let i = 0; i < n; i++) {
      lm[i * 3] = (cx - L[i].x) * sc * va; lm[i * 3 + 1] = (cy - L[i].y) * sc; lm[i * 3 + 2] = -L[i].z * sc * va;
    }
  }

  _hand(v) {
    let r; try { r = this.gr.recognizeForVideo(v, performance.now()); } catch { return; }
    const lm = r.landmarks?.[0], g = r.gestures?.[0]?.[0], h = this.hand;
    if (!lm) { if (++h.miss > 3) { h.on = false; h.gesture = 'None'; h.cand = ''; h.cnt = 0; h.hasRaw = false; } return; }
    const name = g && g.score > .5 ? g.categoryName : 'None';
    if (name === h.cand) h.cnt++; else { h.cand = name; h.cnt = 1; }
    if (h.cnt >= 2) h.gesture = name;
    // 指差しのときは人差し指の先、それ以外は手のひらの中心を位置とする
    let px, py;
    if (h.gesture === 'Pointing_Up') { px = lm[8].x; py = lm[8].y; }
    else { px = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5; py = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5; }
    const tx = clamp((.5 - px) * 2.6, -1.1, 1.1), ty = clamp((.5 - py) * 2.6, -1.1, 1.1);
    if (!h.on) { h.x = tx; h.y = ty; } else { h.x += (tx - h.x) * .55; h.y += (ty - h.y) * .55; }
    for (let i = 0; i < 21; i++) { h.raw[i * 2] = (.5 - lm[i].x) * 2.6; h.raw[i * 2 + 1] = (.5 - lm[i].y) * 2.6; }
    h.on = true; h.miss = 0; h.hasRaw = true;
  }

  _mic() {
    const an = this.an; an.getFloatTimeDomainData(this.tbuf);
    const buf = this.tbuf, N = 1024;
    let rms = 0; for (let i = 0; i < N; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / N);
    if (rms < this.floor) this.floor = rms; else this.floor += (rms - this.floor) * .0015;
    const target = clamp((rms - this.floor * 1.8 - .004) / .1, 0, 1);
    this.vol += (target - this.vol) * (target > this.vol ? .5 : .12);
    // 音高 (正規化自己相関)
    let pitch = 0;
    if (target > .06) {
      const minL = Math.floor(this.sr / 900), maxL = Math.min(1000, Math.floor(this.sr / 75)), ns = this.nsdf;
      let mx = 0;
      for (let l = minL; l <= maxL; l++) {
        let ac = 0, m = 0;
        for (let i = 0; i < N; i++) { const a = buf[i], c = buf[i + l]; ac += a * c; m += a * a + c * c; }
        ns[l] = 2 * ac / (m + 1e-9); if (ns[l] > mx) mx = ns[l];
      }
      if (mx > .62) {
        const th = mx * .9;
        for (let l = minL + 1; l < maxL; l++) {
          if (ns[l] > th && ns[l] > ns[l - 1] && ns[l] >= ns[l + 1]) {
            const a = ns[l - 1], c = ns[l + 1], bb = ns[l], sh = (a - c) / (2 * (a - 2 * bb + c) || 1);
            pitch = this.sr / (l + sh); break;
          }
        }
      }
    }
    if (pitch > 0) { this.pitch = this.pitch > 0 ? this.pitch * Math.pow(pitch / this.pitch, .5) : pitch; this.pitchHold = 6; }
    else if (--this.pitchHold < 0) this.pitch = 0;
    // 声色の明るさ(スペクトル重心)
    an.getByteFrequencyData(this.fbuf);
    const hz = this.sr / 2048; let num = 0, den = 0;
    for (let i = Math.floor(120 / hz); i < Math.floor(6000 / hz); i++) { num += this.fbuf[i] * i * hz; den += this.fbuf[i]; }
    const cen = den > 50 ? num / den : 1200;
    this.state.bright += (clamp((cen - 500) / 2200, 0, 1) - this.state.bright) * .1;
  }

  update(dt, now) {
    const s = this.state, k = this.keys, sim = this.sim;
    if (this.video) this._face(dt, now);
    s.face = now - this.lastFace < .8;
    s.calibrating = !!this.calib && s.cam;
    s.calTarget = s.calibrating ? CAL_PTS[this.calib.step] : null;
    s.calStep = s.calibrating ? this.calib.step : 0; s.calN = CAL_PTS.length; s.calHold = s.calibrating && this.calib.t > .75;
    s.gazeQuality = this.model.quality;
    // キーボードによる代替入力
    const ease = (key, on, up = 10, down = 6) => { sim[key] += ((on ? 1 : 0) - sim[key]) * (1 - Math.exp(-dt * (on ? up : down))); };
    ease('smile', k.s); ease('frown', k.d); ease('jaw', k.a, 14); ease('brow', k.w); ease('blink', k.b, 40, 30); ease('pucker', k.q); ease('vol', k.v, 8, 4);
    const f = this.face;
    if (s.face) {
      s.gx = f.gx; s.gy = f.gy; s.hx = f.hx; s.hy = f.hy; s.hz = f.hz;
      s.landmarks = this.calib ? null : this.lm;
    } else {
      s.gx = this.mouse.x; s.gy = this.mouse.y;
      s.hx += (this.mouse.x * .5 - s.hx) * .05; s.hy += (this.mouse.y * .5 - s.hy) * .05; s.hz *= .95;
      s.landmarks = null;
    }
    // 手: カメラで見つからないときは数字キー(1〜7)＋マウス位置で代用
    const sg = Object.keys(SIM_GEST).find(n => k[n]);
    if (this.hand.on) s.hand = this.hand;
    else { const sh = this.simHand; sh.on = !!sg; sh.gesture = sg ? SIM_GEST[sg] : 'None'; sh.x = this.mouse.x; sh.y = this.mouse.y; s.hand = sh; }
    const fa = s.face ? 1 : 0;
    s.smile = Math.max(f.smile * fa, sim.smile); s.frown = Math.max(f.frown * fa, sim.frown);
    s.jaw = Math.max(f.jaw * fa, sim.jaw); s.brow = Math.max(f.brow * fa, sim.brow); s.pucker = Math.max(f.pucker * fa, sim.pucker);
    s.blinkL = Math.max(f.blinkL * fa, sim.blink); s.blinkR = Math.max(f.blinkR * fa, sim.blink);
    s.valence = clamp(s.smile * 1.4 - s.frown * 1.2, -1, 1);
    if (this.an) this._mic(); else { this.vol = 0; this.pitch = 0; }
    s.vol = Math.max(this.vol, sim.vol * .75);
    s.pitch = sim.vol > .1 && !(this.pitch > 0) ? 196 * Math.pow(2, (s.gy + 1) * .9) : this.pitch;
    return s;
  }
}
