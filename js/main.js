import { Visual } from './visual.js';
import { Sound } from './audio.js';
import { Sense } from './sense.js';
import { Words, WORDS } from './speech.js';

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const NORB = 7;
const CHAPTERS = ['黎明', '潮騒', '星座', '極光', '久遠'];
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const NOTES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];

let visual;
try { visual = new Visual($('gl')); }
catch (e) { const el = $('err'); el.style.display = 'grid'; el.textContent = 'この端末のブラウザでは WebGL2 が使えないため、表示できません。' + e.message; throw e; }
const sound = new Sound();
const sense = new Sense();

const orbs = Array.from({ length: NORB }, () => ({ nx: 0, ny: 0, wx: 0, wy: 0, sx: 0, sy: 0, awake: 0, on: false, pulse: 0, dwell: 0 }));
const hist = new Float32Array(48), histA = new Float32Array(48);
const shock = { x: 0, y: 0, t: 9 };
const handLm = new Float32Array(63);
const FX = { rayA: 0, rayF: 0, rayP: { x: 0, y: 0 }, waveA: 0, flower: 0, sunP: 0, sunA: 0, sunType: 1, night: 0, lift: 0, met: [0, 0, 0, 0], metT: 99, starB: 0, tgtA: 0, tgtB: 0, tgtBoff: [0, 0], tgtBcol: [1, 1, 1] };
const G = {
  phase: 'idle', chapter: 0, bloomT: 0, climax: 0, hue: 0, link: 1,
  val: 0, energy: 0, beat: 0, flash: 0, gazeOn: 0, orbOn: 0, volSlow: 0, histT: 0, histY: 0, histAmp: 0,
  bias: 0, biasT: 0, boost: 0, wind: { x: 0, y: 0 }, handW: 0, handOn: 0, gPrev: 'None', gHold: 0, gOnceT: -9,
  hp: { x: 0, y: 0 }, hw: { x: 0, y: 0 }, waves: [],
  rayT: 99, rayP: { x: 0, y: 0 }, waveT: 99, flowerT: 99, sunT: 99, sunType: 1, nightT: 99, metT: 99, met: [0, 0, 0, 0], metOrb: -1, starB: 0, glyphT: 99, handMeshA: 0,
  auto: false, hud: true, mouseMode: false, jawFired: false, burstCd: 0,
  edge: { both: false, wl: false, wr: false, jaw: false },
  cam: { x: 0, y: 0, z: 3.2 }, gp: { x: 0, y: 0 }, ap: { x: 0, y: 0, t: 0 },
};

function layout() {
  const rot = Math.random() * 6.2832;
  orbs.forEach((o, i) => {
    const a = rot + i / NORB * 6.2832 + (Math.random() - .5) * .35, r = .52 + Math.random() * .26;
    o.nx = Math.cos(a) * r * .92; o.ny = Math.sin(a) * r * .72; o.on = false; o.dwell = 0;
  });
  G.link = [1, 2, 3][G.chapter % 3];
}
layout();

// ---- 表示まわり ----
let titleTimer;
function showTitle(big, small, ms = 4200) {
  $('tBig').textContent = big; $('tSmall').textContent = small;
  $('title').classList.add('on'); clearTimeout(titleTimer);
  titleTimer = setTimeout(() => $('title').classList.remove('on'), ms);
}
const hintEl = $('hint'); let hintText = '';
function setHint(text) {
  if (text === hintText) return; hintText = text;
  hintEl.classList.remove('on');
  setTimeout(() => { if (hintText === text) { hintEl.textContent = text; if (text) hintEl.classList.add('on'); } }, 900);
}
const tut = [
  { text: '光る輪を、見つめてください', done: s => orbs.some(o => o.on) },
  { text: '微笑むと、世界があたたかくなる', done: s => G.val > .4 },
  { text: '声を出すと、光が生まれる', done: s => s.vol > .35 },
  { text: '口を大きく開くと、波紋がひろがる', done: s => G.jawFired },
  { text: '眉を上げると、旋律が駆け上がる', done: s => s.brow > .5 },
  { text: '眉をひそめると、夜が深くなる', done: s => G.val < -.35 },
  { text: '七つの輪を、すべて目覚めさせて', done: s => G.phase === 'bloom' },
];
let tutI = 0, tutT = 0;
function tutorial(s, dt) {
  if (G.phase === 'idle' || tutI >= tut.length) return;
  if (s.calibrating) { setHint(s.face ? `白い点を、順に見つめてください（${s.calStep + 1}／${s.calN}）` : '顔をカメラに向けてください'); return; }
  if (G.phase === 'bloom') { setHint(''); if (tutI === tut.length - 1) tutI++; return; }
  const c = tut[tutI]; tutT += dt; setHint(c.text);
  if ((tutT > 3.5 && c.done(s)) || (tutT > 26 && tutI < tut.length - 1)) { tutI++; tutT = 0; if (tutI >= tut.length) setHint(''); }
}

// 認識した言葉やジェスチャーを画面に大きく浮かべる
const wordEl = $('word');
function showWord(text, small) {
  wordEl.textContent = text; wordEl.classList.toggle('small', !!small);
  wordEl.classList.remove('show'); void wordEl.offsetWidth; wordEl.classList.add('show');
}

// ---- 粒でつくる形 ----
const TN = 4096;
// 言葉の文字を粒で書く: 文字を見えないキャンバスに描き、インクのある場所から4096点を拾う
const gc = document.createElement('canvas'); gc.width = 512; gc.height = 192;
const g2 = gc.getContext('2d', { willReadFrequently: true });
function glyph(text) {
  g2.clearRect(0, 0, gc.width, gc.height);
  g2.fillStyle = '#fff'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  let size = 150; g2.font = `300 ${size}px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif`;
  const tw = g2.measureText(text).width; if (tw > 480) { size *= 480 / tw; g2.font = `300 ${size}px "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif`; }
  g2.fillText(text, gc.width / 2, gc.height / 2);
  const d = g2.getImageData(0, 0, gc.width, gc.height).data, ink = [];
  for (let i = 0; i < gc.width * gc.height; i++) if (d[i * 4 + 3] > 110) ink.push(i);
  if (!ink.length) return;
  // 1文字なら画面の高さの約3割。長い言葉は横幅に収まるよう縮める
  const hh = visual.halfH(), hw = hh * visual.aspect, k = Math.min(hh * .62 / 150, hw * 1.7 / gc.width);
  const pts = new Float32Array(TN * 4);
  for (let i = 0; i < TN; i++) {
    const q = ink[(Math.random() * ink.length) | 0], x = q % gc.width + Math.random(), y = (q / gc.width | 0) + Math.random();
    pts[i * 4] = (x - gc.width / 2) * k; pts[i * 4 + 1] = (gc.height / 2 - y) * k + hh * .3; pts[i * 4 + 2] = (Math.random() - .5) * .04;
  }
  visual.setTargets(0, pts); G.glyphT = 0;
}
// 手: 顔と同じように、細い線を折り重ねた網で形づくる。
// 指は「輪を並べた細い筒」、手のひらは表と裏の二重の網。輪を少しずつねじって、線が交差して見えるようにする
const FING = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const RING = 6, NR = 10, PU = 15, PV = 11, PALM0 = 5 * NR * RING, HM_VERTS = PALM0 + 2 * PU * PV;
const handMesh = new Float32Array(HM_VERTS * 3);
{
  const idx = [];
  for (let f = 0; f < 5; f++) for (let i = 0; i < NR; i++) for (let j = 0; j < RING; j++) {
    const a = f * NR * RING + i * RING + j, b = f * NR * RING + i * RING + (j + 1) % RING;
    idx.push(a, b);
    if (i < NR - 1) idx.push(a, a + RING, a, b + RING);
  }
  for (let l = 0; l < 2; l++) for (let v = 0; v < PV; v++) for (let u = 0; u < PU; u++) {
    const a = PALM0 + l * PU * PV + v * PU + u;
    if (u < PU - 1) idx.push(a, a + 1);
    if (v < PV - 1) idx.push(a, a + PU);
    // 斜めの線は表と裏で向きを逆にして、重なったときに細かい菱形の編み目に見せる
    if (u < PU - 1 && v < PV - 1) { if (l === 0) idx.push(a, a + PU + 1); else idx.push(a + 1, a + PU); }
    if (l === 0 && (u + v) % 3 === 0) idx.push(a, a + PU * PV);   // 表と裏をつなぐ線
  }
  visual.setHandMesh(new Uint16Array(idx), HM_VERTS);
}
function buildHand(lm) {
  const X = i => lm[i * 3], Y = i => lm[i * 3 + 1], m = handMesh;
  const size = Math.hypot(X(9) - X(0), Y(9) - Y(0)) + 1e-4;
  for (let f = 0; f < 5; f++) {
    const c = FING[f], r0 = size * (f === 0 ? .115 : .095);
    for (let i = 0; i < NR; i++) {
      const t = i / (NR - 1) * 3, sg = Math.min(2, Math.floor(t)), lt = t - sg, a = c[sg], b = c[sg + 1];
      const cx = X(a) + (X(b) - X(a)) * lt, cy = Y(a) + (Y(b) - Y(a)) * lt;
      let tx = X(b) - X(a), ty = Y(b) - Y(a); const tl = Math.hypot(tx, ty) + 1e-5; tx /= tl; ty /= tl;
      const r = r0 * (1 - .5 * i / (NR - 1));
      for (let j = 0; j < RING; j++) {
        const ang = j / RING * 6.2832 + i * .45, o = (f * NR * RING + i * RING + j) * 3, cs = Math.cos(ang) * r;
        m[o] = cx - ty * cs; m[o + 1] = cy + tx * cs; m[o + 2] = Math.sin(ang) * r;
      }
    }
  }
  // 手のひら: 手首側の辺(親指の付け根→手首→小指側)と、指の付け根の列のあいだに網を張る
  const px = X(0) + (X(17) - X(9)) * .6, py = Y(0) + (Y(17) - Y(9)) * .6, top = [5, 9, 13, 17];
  for (let l = 0; l < 2; l++) for (let v = 0; v < PV; v++) for (let u = 0; u < PU; u++) {
    const fu = u / (PU - 1), fv = v / (PV - 1);
    let bx, by;
    if (fu < .5) { bx = X(1) + (X(0) - X(1)) * fu * 2; by = Y(1) + (Y(0) - Y(1)) * fu * 2; }
    else { bx = X(0) + (px - X(0)) * (fu - .5) * 2; by = Y(0) + (py - Y(0)) * (fu - .5) * 2; }
    const tt = fu * 3, ts = Math.min(2, Math.floor(tt)), tl = tt - ts, ta = top[ts], tb = top[ts + 1];
    const tx = X(ta) + (X(tb) - X(ta)) * tl, ty = Y(ta) + (Y(tb) - Y(ta)) * tl;
    const o = (PALM0 + l * PU * PV + v * PU + u) * 3;
    m[o] = bx + (tx - bx) * fv; m[o + 1] = by + (ty - by) * fv;
    m[o + 2] = (l ? -1 : 1) * size * (.05 + .14 * Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv));
  }
}
// 太陽: 中心ほど密な円。月: 円から少しずらした円をくり抜いた三日月
function shape(kind) {
  const pts = new Float32Array(TN * 4), hh = visual.halfH(), hw = hh * visual.aspect;
  for (let i = 0; i < TN; i++) {
    let x, y;
    if (kind === 'sun') { const a = Math.random() * 6.2832, r = .26 * Math.pow(Math.random(), .75); x = Math.cos(a) * r; y = Math.sin(a) * r; }
    else {
      do { const a = Math.random() * 6.2832, r = .3 * Math.sqrt(Math.random()); x = Math.cos(a) * r; y = Math.sin(a) * r; } while (Math.hypot(x - .13, y - .06) < .27);
      x += hw * .55; y += hh * .52;
    }
    pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = (Math.random() - .5) * .05;
  }
  visual.setTargets(1, pts);
}

function statusText(s) {
  const cam = G.mouseMode ? 'マウス操作' : !s.cam ? G.camMsg || 'カメラ準備中…' : s.calibrating ? '視線を合わせています' : s.face ? `顔を追跡中${s.gazeQuality ? '・視線の合い具合 ' + s.gazeQuality : ''}` : '顔を探しています（マウスで代用中）';
  const mic = s.mic ? 'マイク 入' : 'マイクなし（V キーで代用）';
  const hand = s.hand.on ? `<br>手 ${GEST[s.hand.gesture]?.label || '認識中'}` : '';
  const wd = words.on ? '<br>言葉 入（音声は認識サービスへ送信中）' : '';
  return `${cam}<br>${mic}${hand}${wd}${G.auto ? '<br>自動演奏中' : ''}`;
}
const KEYS_CAM = 'H 表示切替 ・ F 全画面 ・ C 視線合わせ ・ ↑↓ 視線感度 ・ M 顔の光 ・ P 自動演奏 ・ K 言葉 ・ N / Esc / スペース 音を止める';
const KEYS_SIM = 'マウス=視線 ・ S 微笑み ・ D ひそめる ・ A 口 ・ W 眉 ・ B まばたき ・ Q すぼめる ・ V 声 ・ 1〜7 手の形';

// ---- 進行 ----
function awaken(i) {
  const o = orbs[i]; if (o.on) return;
  o.on = true; o.dwell = 0; o.pulse = 1.5;
  sound.setLayer(i, true); sound.awaken(i);
  shock.x = o.wx; shock.y = o.wy; shock.t = 0; G.flash = .6;
  if (orbs.every(o => o.on)) {
    G.phase = 'bloom'; G.bloomT = 0;
    sound.setClimax(true); sound.bloom();
    setTimeout(() => showTitle('満開', `第${NUM[G.chapter % 10]}章 ${CHAPTERS[G.chapter % CHAPTERS.length]} — 成就`, 5000), 1500);
  }
}
function nextChapter() {
  G.chapter++; G.phase = 'play';
  sound.setClimax(false);
  for (let i = 0; i < NORB; i++) sound.setLayer(i, false);
  sound.setRoot(45 + (G.chapter * 7 + 5) % 12);
  G.hue = (G.chapter * .11) % .33;
  layout();
  showTitle(CHAPTERS[G.chapter % CHAPTERS.length], `第${NUM[G.chapter % 10]}章`);
}

// ---- 手と言葉のアクション ----
// w: 光の粒に働く力(正=引き寄せる / 負=押し出す)。once: 形を作った瞬間に一度だけ起きる
const GEST = {
  Open_Palm: { label: '放つ', w: -1 }, Closed_Fist: { label: '集める', w: 1.3 }, Pointing_Up: { label: '指す', w: .35 },
  Victory: { label: '転調', once: true }, Thumb_Up: { label: '陽', once: true }, Thumb_Down: { label: '陰', once: true }, ILoveYou: { label: '流星', once: true },
};
function shockAt(x, y, flash = .5) { shock.x = x; shock.y = y; shock.t = 0; G.flash = Math.max(G.flash, flash); }
function setBias(v) { G.bias = v; G.biasT = 12; }
function flower() { G.flowerT = 0; sound.sparkle(); for (const o of orbs) o.pulse = 2; }
// 言葉ごとに、ひと目で違いが分かる専用の動きを起こす
function act(id) {
  if (id === 'light') { G.rayT = 0; G.rayP.x = G.gp.x; G.rayP.y = G.gp.y; G.flash = 1; sound.burst(); }          // 光条が放射し、粒が吹き飛ぶ
  else if (id === 'wind') { G.wind.x = (Math.random() < .5 ? -1 : 1) * 3.4; G.wind.y = .4; sound.gust(); }      // 横に走る筋と、流される粒
  else if (id === 'wave') { G.waveT = 0; sound.surf(); }                                                        // 画面全体が水面のようにゆらぐ
  else if (id === 'star') {                                                                                     // 流れ星が輪へ飛び、目覚めさせる
    G.starB = 1;
    let best = -1, bd = 1e9;
    if (G.phase === 'play') orbs.forEach((o, i) => { const d = Math.hypot(G.gp.x - o.sx, G.gp.y - o.sy); if (!o.on && d < bd) { bd = d; best = i; } });
    const asp = visual.aspect, sx = (Math.random() < .5 ? -1 : 1) * asp * .55;
    const tx = best >= 0 ? orbs[best].sx : -sx * .5, ty = best >= 0 ? orbs[best].sy : -.2;
    G.met = [sx, .58, tx, ty]; G.metT = 0; G.metOrb = best; sound.wink(Math.sign(sx));
  }
  else if (id === 'flower') flower();                                                                           // 粒が五弁の花のかたちに集まる
  else if (id === 'morning') { shape('sun'); G.sunT = 0; G.sunType = 1; G.nightT = 99; setBias(1); sound.chordBell(true); }    // 太陽が昇り、粒が立ちのぼる
  else if (id === 'evening') { shape('sun'); G.sunT = 0; G.sunType = -1; G.nightT = 99; setBias(-.35); sound.chordBell(false); } // 赤い太陽が沈む
  else if (id === 'night') { shape('moon'); G.nightT = 0; G.sunT = 99; setBias(-1); sound.chordBell(false); }                   // 暗く沈み、月と満天の星
  else if (id === 'fast') sound.tempoMul = 1.3;
  else if (id === 'slow') sound.tempoMul = .75;
  else if (id === 'stop') setMuted(true);
  else if (id === 'start') setMuted(false);
}
function gestureOnce(g) {
  if (g === 'Victory') {
    G.hue = (G.hue + .17) % 1; sound.setRoot(45 + (sound.root - 45 + 7) % 12); sound.awaken(3); G.flash = Math.max(G.flash, .5);
  } else if (g === 'Thumb_Up') act('morning');
  else if (g === 'Thumb_Down') act('night');
  else if (g === 'ILoveYou') { flower(); G.waves.push(0, .3, .6, .9); G.meteor = true; }
}
const words = new Words(w => { if (G.phase === 'idle') return; glyph(w.label); act(w.id); }, st => {
  const b = $('wordsBtn'); b.textContent = st === 'on' ? '言葉 オン' : '言葉 オフ'; b.classList.toggle('muted', st === 'on');
  if (st === 'denied') showWord('マイクが使えません', true);
  G.lastSt = '';
});
function toggleWords() {
  if (!words.supported) { showWord('このブラウザは言葉の認識に未対応です', true); return; }
  words.on ? words.stop() : words.start();
}
$('wordsBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleWords(); });

// 音の停止/再開。止めるときは音声エンジンごと止めるので、確実に無音になる
function setMuted(m) {
  sound.setMute(m);
  const b = $('mute'); b.textContent = m ? '音を出す' : '音を止める'; b.classList.toggle('muted', m);
  if (sound.ready) { if (m) setTimeout(() => { if (sound.muted) sound.ctx.suspend(); }, 250); else sound.ctx.resume(); }
}
$('mute').addEventListener('click', e => { e.currentTarget.blur(); setMuted(!sound.muted); });

async function begin(useCam) {
  if (G.phase !== 'idle') return;
  $('intro').classList.add('off'); document.body.classList.add('play');
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  await ctx.resume();
  sound.start(ctx);
  // 動作確認用: URL に ?silent を付けると無音で始まる(N キーで音を出せる)
  if (new URLSearchParams(location.search).has('silent')) setMuted(true);
  G.phase = 'play'; G.mouseMode = !useCam;
  for (const id of ['hud', 'status', 'keys', 'legend']) $(id).classList.remove('off');
  $('keys').innerHTML = useCam ? KEYS_CAM : KEYS_CAM + '<br>' + KEYS_SIM;
  showTitle(CHAPTERS[0], '第一章');
  if (useCam) {
    try {
      await sense.initMedia(ctx, $('cam'), m => { G.camMsg = m; });
      if (sense.topology) visual.setFaceTopology(sense.topology);
      // 言葉の認識は最初からオン(左上のボタンか K キーで切れる)
      if (sense.state.mic && words.supported && !words.on) words.start();
      if (!sense.state.cam) { G.mouseMode = true; $('keys').innerHTML = KEYS_CAM + '<br>' + KEYS_SIM; }
    } catch (e) {
      console.warn('camera/mic unavailable', e);
      G.mouseMode = true; $('keys').innerHTML = KEYS_CAM + '<br>' + KEYS_SIM;
    }
  }
}
$('go').addEventListener('click', () => begin(true));
$('goMouse').addEventListener('click', () => begin(false));

addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'h') { G.hud = !G.hud; for (const id of ['hud', 'status', 'keys', 'legend']) $(id).classList.toggle('off', !G.hud); }
  else if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  else if (k === 'c') sense.calibrate();
  else if (k === 'p') G.auto = !G.auto;
  else if (k === 'k') toggleWords();
  else if (k === 'm') visual.faceOn = !visual.faceOn;
  else if (k === 'n' || k === 'escape' || k === ' ') { e.preventDefault(); setMuted(!sound.muted); }
  else if (k === 'arrowup') sense.sens = Math.min(2.5, sense.sens * 1.12);
  else if (k === 'arrowdown') sense.sens = Math.max(.4, sense.sens / 1.12);
});

// 自動演奏(鑑賞モード)
function autopilot(s, t, dt, asp) {
  const a = G.ap, tgt = orbs.find(o => !o.on);
  let tx, ty;
  if (tgt && G.phase === 'play' && (t % 9) > 2.5) { tx = tgt.sx; ty = tgt.sy; }
  else { tx = Math.sin(t * .43) * .3 * asp; ty = Math.sin(t * .61 + 1) * .3; }
  const k = 1 - Math.exp(-dt * 2.2); a.x += (tx - a.x) * k; a.y += (ty - a.y) * k;
  s.gx = a.x / (.5 * asp); s.gy = a.y / .5;
  s.valence = Math.sin(t * .11); s.smile = Math.max(0, s.valence); s.frown = Math.max(0, -s.valence);
  s.jaw = Math.pow(Math.max(0, Math.sin(t * .37)), 10);
  s.brow = Math.sin(t * .19) > .6 ? 1 : 0;
  s.vol = Math.pow(Math.max(0, Math.sin(t * .23 + 2)), 2) * .8;
  s.pitch = s.vol > .05 ? 220 * Math.pow(2, Math.sin(t * .7) * .9) : 0;
  const bl = (t % 3.7) < .12 ? 1 : 0; s.blinkL = s.blinkR = bl;
  s.pucker = 0;
}

// ---- メインループ ----
let last = performance.now() / 1000;
function frame(nowMs, manual) {
  if (!manual) requestAnimationFrame(frame);
  const t = nowMs / 1000, dt = clamp(t - last, 1 / 240, .05); last = t;
  const asp = visual.aspect, hh = visual.halfH(), hw = hh * asp;
  const s = sense.update(dt, t);
  const playing = G.phase !== 'idle';
  if (G.auto && playing) autopilot(s, t, dt, asp);
  const ez = r => 1 - Math.exp(-dt * r);

  // 頭の位置で視差(のぞき込むと奥行きが動く)
  G.cam.x += (s.hx * .28 - G.cam.x) * ez(4); G.cam.y += (s.hy * .18 - G.cam.y) * ez(4); G.cam.z += (3.2 - s.hz * .55 - G.cam.z) * ez(3);
  visual.cam.x = G.cam.x; visual.cam.y = G.cam.y; visual.cam.z = G.cam.z;

  // 気分とエネルギー
  G.biasT -= dt; if (G.biasT < 0) G.bias *= Math.exp(-dt * .8);
  G.val += (clamp(s.valence + G.bias, -1, 1) - G.val) * ez(2.2);
  const awakeN = orbs.reduce((n, o) => n + (o.on ? 1 : 0), 0);
  G.energy += (clamp(s.vol * 1.2 + s.jaw * .4 + awakeN / 7 * .5 + G.climax, 0, 1.7) - G.energy) * ez(3);

  // 手: 位置を光の粒に働く力にし、形の変化をきっかけにする
  const h = s.hand, handLive = h.on && playing && !s.calibrating;
  let hwT = 0, pointing = false;
  if (handLive) {
    G.hp.x = clamp(h.x, -1.05, 1.05) * .5 * asp; G.hp.y = clamp(h.y, -1.05, 1.05) * .5;
    const w = visual.unproject(G.hp.x, G.hp.y); G.hw.x = w.x; G.hw.y = w.y;
    const g = h.gesture, def = GEST[g];
    hwT = def ? (def.w ?? .15) : .15; pointing = g === 'Pointing_Up';
    if (g !== G.gPrev) {
      if (G.gPrev === 'Closed_Fist' && g === 'Open_Palm' && G.gHold > .3) { sound.burst(); shockAt(w.x, w.y, .9); showWord('解き放つ', true); }
      else if (def?.once) { if (t - G.gOnceT > 1.2) { G.gOnceT = t; gestureOnce(g); showWord(def.label, true); } }
      else if (def) { showWord(def.label, true); if (g === 'Open_Palm') sound.swell(); else if (g === 'Closed_Fist') sound.rumble(); }
      G.gPrev = g; G.gHold = 0;
    } else G.gHold += dt;
    if (h.hasRaw) {
      // 認識結果は数フレームおきに届くので、なめらかに追わせてから網を組み立てる
      const kf = G.handMeshA < .05 ? 1 : ez(22);
      for (let i = 0; i < 21; i++) {
        const q = visual.unproject(h.raw[i * 2] * .5 * asp, h.raw[i * 2 + 1] * .5);
        handLm[i * 3] += (q.x - handLm[i * 3]) * kf; handLm[i * 3 + 1] += (q.y - handLm[i * 3 + 1]) * kf;
      }
      buildHand(handLm);
    }
  } else { G.gPrev = 'None'; G.gHold = 0; }
  G.handMeshA += ((handLive && h.hasRaw ? 1 : 0) - G.handMeshA) * ez(7);
  G.handW += (hwT - G.handW) * ez(8); G.handOn += ((handLive ? 1 : 0) - G.handOn) * ez(6);
  // 言葉ごとの動きの時間経過
  G.rayT += dt; G.waveT += dt; G.flowerT += dt; G.sunT += dt; G.nightT += dt; G.metT += dt; G.starB *= Math.exp(-dt * .6);
  if (G.metOrb >= 0 && G.metT > .55) { const i = G.metOrb; G.metOrb = -1; if (G.phase === 'play') awaken(i); }
  const sm = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const sunA = G.sunType > 0 ? sm(G.sunT / .8) * sm((13 - G.sunT) / 3) : sm(G.sunT / .8) * sm((9 - G.sunT) / 2.5);
  const nightA = sm(G.nightT / 2) * sm((14 - G.nightT) / 3);
  FX.rayA = Math.exp(-G.rayT * 1.2); FX.rayF = Math.exp(-G.rayT * 4.5); FX.rayP = G.rayP;
  FX.waveA = sm(G.waveT / .35) * sm((4.6 - G.waveT) / 1.8);
  FX.flower = sm(G.flowerT / .7) * sm((6 - G.flowerT) / 1.6);
  FX.sunP = G.sunType > 0 ? sm(G.sunT / 5) : 1 - sm(G.sunT / 7); FX.sunA = sunA; FX.sunType = G.sunType;
  FX.night = nightA; FX.lift = (G.sunType > 0 ? .3 : -.1) * sunA - .22 * nightA;
  FX.met = G.met; FX.metT = G.metT; FX.starB = G.starB;
  // 文字は粒が集まって現れ、ほどけて消える。太陽と月も粒でできている
  G.glyphT += dt; FX.tgtA = sm(G.glyphT / .45) * sm((2.9 - G.glyphT) / .7);
  if (nightA > sunA) { FX.tgtB = nightA; FX.tgtBoff[0] = 0; FX.tgtBoff[1] = 0; FX.tgtBcol = [.8, .88, 1]; }
  else {
    const sw = visual.unproject(0, -.7 + .86 * FX.sunP);
    FX.tgtB = sunA; FX.tgtBoff[0] = sw.x; FX.tgtBoff[1] = sw.y; FX.tgtBcol = G.sunType > 0 ? [1, .8, .42] : [1, .36, .14];
  }
  // 言葉や形で起こした波・風・流星
  G.wind.x *= Math.exp(-dt * 1.1); G.wind.y *= Math.exp(-dt * 1.1); G.boost *= Math.exp(-dt * .7);
  for (let i = G.waves.length - 1; i >= 0; i--) {
    if ((G.waves[i] -= dt) <= 0) {
      G.waves.splice(i, 1);
      if (G.meteor) shockAt((Math.random() * 2 - 1) * hw * .8, (Math.random() * 2 - 1) * hh * .7, .6);
      else { const c = visual.unproject(G.gp.x, G.gp.y); shockAt(c.x, c.y, .5); }
      if (!G.waves.length) G.meteor = false;
    }
  }

  // 視線 → 画面座標。輪の近くでは吸い寄せて、狙いやすくする
  let gx = clamp(s.gx, -1.05, 1.05) * .5 * asp, gy = clamp(s.gy, -1.05, 1.05) * .5;
  // 視線は数度の誤差が残るので、「一番近い輪」がはっきりしていれば、そこへ強めに引き寄せる
  const rgx = gx, rgy = gy;
  let near = null, nd = 1e9, nd2 = 1e9;
  for (const o of orbs) {
    o.wx = o.nx * hw; o.wy = o.ny * hh;
    const p = visual.project(o.wx, o.wy); o.sx = p.x; o.sy = p.y;
    const d = Math.hypot(gx - p.x, gy - p.y);
    if (!o.on) { if (d < nd) { nd2 = nd; nd = d; near = o; } else if (d < nd2) nd2 = d; }
  }
  if (near && nd < .3 && G.phase === 'play' && !s.calibrating) {
    const clear = clamp((nd2 - nd) / (nd2 * .3 + 1e-6), 0, 1), k = (1 - (nd / .3) ** 2) * .92 * clear;
    gx += (near.sx - gx) * k; gy += (near.sy - gy) * k;
  }
  // 引き寄せでカーソルが飛ばないよう、表示位置はなめらかに追わせる
  gx = G.gp.x + (gx - G.gp.x) * ez(16); gy = G.gp.y + (gy - G.gp.y) * ez(16);
  G.gp.x = gx; G.gp.y = gy;
  orbs.forEach((o, i) => {
    if (!o.on) {
      let d = Math.hypot(gx - o.sx, gy - o.sy);
      const byGaze = d < .13;
      if (pointing) d = Math.min(d, Math.hypot(G.hp.x - o.sx, G.hp.y - o.sy) * .8);
      if (G.phase === 'play' && !s.calibrating && d < (o.dwell > .1 ? .13 : .09)) {
        o.dwell += dt / .9;
        if (o.dwell >= 1) {
          // 視線で目覚めさせたときは、輪の位置を正解としてズレを自動で補正する
          if (byGaze && s.face && !G.auto) sense.nudge(o.sx / (.5 * asp) - rgx / (.5 * asp), o.sy / .5 - rgy / .5);
          awaken(i);
        }
      }
      else o.dwell = Math.max(0, o.dwell - dt * .45);
    }
    o.awake += ((o.on ? 1 : 0) - o.awake) * ez(4); o.pulse *= Math.exp(-dt * 5);
  });

  // 音のイベント → 光
  for (const e of sound.poll()) {
    if (e.type === 'note') orbs[e.layer].pulse = Math.max(orbs[e.layer].pulse, 1);
    else if (e.type === 'kick') G.beat = 1;
  }
  G.beat *= Math.exp(-dt * 6); G.flash *= Math.exp(-dt * 5);

  // 表情・声のきっかけ
  if (playing) {
    const E = G.edge, bl = s.blinkL, br = s.blinkR, both = Math.min(bl, br);
    if (!E.both && both > .58) { E.both = true; sound.blink(); G.flash = Math.max(G.flash, .35); }
    else if (E.both && both < .35) E.both = false;
    const wl = bl > .62 && br < .3, wr = br > .62 && bl < .3;
    if (wl && !E.wl) { sound.wink(-1); G.flash = Math.max(G.flash, .3); } E.wl = wl;
    if (wr && !E.wr) { sound.wink(1); G.flash = Math.max(G.flash, .3); } E.wr = wr;
    const gw = visual.unproject(gx, gy);
    if (!E.jaw && s.jaw > .55) { E.jaw = true; G.jawFired = true; sound.gong(); shock.x = gw.x; shock.y = gw.y; shock.t = 0; G.flash = Math.max(G.flash, .5); }
    else if (E.jaw && s.jaw < .3) E.jaw = false;
    G.burstCd -= dt;
    if (s.vol - G.volSlow > .4 && G.burstCd < 0 && shock.t > .5) { G.burstCd = 1.2; sound.burst(); shock.x = gw.x; shock.y = gw.y; shock.t = 0; G.flash = Math.max(G.flash, .7); }
  }
  G.volSlow += (s.vol - G.volSlow) * ez(4);
  shock.t += dt;

  // 声の軌跡
  G.histT += dt;
  if (s.pitch > 0) G.histY += (clamp(Math.log2(s.pitch / 110) / 3 * 2 - 1, -1, 1) - G.histY) * ez(G.histAmp < .03 ? 60 : 7);
  G.histAmp += ((playing ? (s.pitch > 0 ? s.vol : s.vol * .35) : 0) - G.histAmp) * ez(6);
  if (G.histT > .04) {
    G.histT = 0; hist.copyWithin(1, 0); histA.copyWithin(1, 0);
    hist[0] = G.histY; histA[0] = G.histAmp;
  }

  // 満開 → 次の章
  if (G.phase === 'bloom') {
    G.bloomT += dt;
    G.climax = clamp(G.bloomT / 2.5, 0, 1) * clamp((24 - G.bloomT) / 4, 0, 1);
    if (G.bloomT > 24) nextChapter();
  } else G.climax *= Math.exp(-dt * 2);

  G.gazeOn += ((playing ? 1 : 0) - G.gazeOn) * ez(3);
  G.orbOn += ((playing ? 1 : 0) - G.orbOn) * ez(1.5);

  // 視線合わせの目印
  const cd = $('calDot');
  if (s.calTarget && playing) {
    cd.style.display = 'block'; cd.style.left = (50 + s.calTarget[0] * 50) + '%'; cd.style.top = (50 - s.calTarget[1] * 50) + '%';
    cd.classList.toggle('hold', !!s.calHold);
  } else if (cd.style.display !== 'none') cd.style.display = 'none';

  sound.update(s, G.energy, G.val, G.climax);
  tutorial(s, dt);

  const v = G.val, w = Math.max(0, v), c = Math.max(0, -v), m = 1 - w - c, fi = .03 + s.vol * .05 + G.beat * .015;
  visual.frame({
    t, dt, gaze: G.gp, gazeOn: G.gazeOn * (s.calibrating ? 0 : 1), orbOn: G.orbOn, val: G.val, hue: G.hue, vol: s.vol, energy: G.energy,
    climax: G.climax, beat: Math.max(G.beat, (sound.level || 0) * .3), flash: G.flash, bright: s.bright,
    orbs, link: G.link, hist, histA, shock, face: s.landmarks,
    hand: { x: G.hw.x, y: G.hw.y, w: G.handW * G.handOn }, handP: { x: G.hp.x, y: G.hp.y, on: G.handOn }, wind: G.wind,
    fx: FX, handMesh: G.handMeshA > .01 ? handMesh : null, handMeshA: G.handMeshA,
    faceCol: [(w * 1 + m * .4 + c * .65) * fi, (w * .7 + m * .7 + c * .3) * fi, (w * .4 + m * 1 + c * .95) * fi],
  });

  // HUD
  if (G.hud && playing) {
    $('mVal').style.transform = `scaleX(${G.val.toFixed(3)})`;
    $('mValT').textContent = G.val > .25 ? '陽' : G.val < -.25 ? '陰' : '凪';
    $('mJaw').style.transform = `scaleX(${s.jaw.toFixed(3)})`;
    $('mBrow').style.transform = `scaleX(${s.brow.toFixed(3)})`;
    $('mVol').style.transform = `scaleX(${s.vol.toFixed(3)})`;
    $('mNote').textContent = s.pitch > 0 ? NOTES[((Math.round(69 + 12 * Math.log2(s.pitch / 440)) % 12) + 12) % 12] : '';
    const st = statusText(s); if (st !== G.lastSt) { G.lastSt = st; $('status').innerHTML = st; }
  }
}
requestAnimationFrame(frame);

// 検証用
window.__kyomei = {
  G, orbs, sense, sound, visual, awaken, words, act, WORDS, glyph,
  // 確認用のコマ送り: 画面が隠れていて描画が止まっているときでも、指定した秒数ぶん進める
  step(sec) { let now = last * 1000; for (let i = 0, n = Math.round(sec * 60); i < n; i++) { now += 1000 / 60; frame(now, true); } },
};
