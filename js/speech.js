// 言葉の認識: ブラウザの音声認識で日本語を聞き取り、決めた言葉が出たら知らせる。
// 注意: Chrome では音声がブラウザ提供元の認識サービスへ送られる。だから利用者がオンにしたときだけ動かす。

export const WORDS = [
  { id: 'light', label: '光', re: /光|ひかり|ヒカリ/g },
  { id: 'wind', label: '風', re: /風|かぜ|カゼ/g },
  { id: 'wave', label: '波', re: /波|なみ|ナミ|海/g },
  { id: 'star', label: '星', re: /星|ほし|ホシ/g },
  { id: 'flower', label: '花', re: /花|はな|ハナ|咲/g },
  { id: 'morning', label: '朝', re: /朝|あさ|明るく/g },
  { id: 'evening', label: '夕', re: /夕|ゆうがた|ゆうやけ/g },
  { id: 'night', label: '夜', re: /夜|よる|暗く/g },
  { id: 'fast', label: '速く', re: /速く|早く|はやく/g },
  { id: 'slow', label: 'ゆっくり', re: /ゆっくり/g },
  // 聞き取りは同じ読みの別の字で返ってくることが多い(始めて→初めて、再開→再会、止めて→やめて など)ので、それも拾う
  { id: 'stop', label: '止めて', re: /止め|停め|とめて|止まって|とまって|やめて|辞めて|ストップ|静かに/g },
  { id: 'start', label: '再開して', re: /再開|再会|さいかい|サイカイ|最下位して|始め|初め|はじめ|スタート|音を出して|鳴らして/g },
];

export class Words {
  constructor(onWord, onState) {
    this.onWord = onWord; this.onState = onState || (() => { });
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.on = false; this.session = 0; this.fired = new Map();
  }
  get supported() { return !!this.SR; }

  start() {
    if (!this.SR || this.on) return false;
    const r = this.rec = new this.SR();
    r.lang = 'ja-JP'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 4;
    r.onresult = e => {
      // 第一候補だけでなく、ほかの候補にも言葉が入っていれば拾う
      for (let i = e.resultIndex; i < e.results.length; i++) this.scan(`${this.session}:${i}`, Array.from(e.results[i], a => a.transcript));
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { this.on = false; this.onState('denied'); }
    };
    // 無音が続くと自動で切れるので、オンの間はつなぎ直す
    r.onend = () => { if (this.on) { this.session++; this.fired.clear(); setTimeout(() => { if (this.on) try { r.start(); } catch { } }, 300); } };
    this.on = true;
    try { r.start(); } catch { this.on = false; return false; }
    this.onState('on');
    return true;
  }
  stop() { this.on = false; try { this.rec?.stop(); } catch { } this.onState('off'); }

  // 途中経過の文字列は同じ発話で何度も届くので、言葉ごとに「何回目まで反応したか」を覚えておく
  scan(key, text) {
    const texts = Array.isArray(text) ? text : [text];
    for (const w of WORDS) {
      const n = Math.max(0, ...texts.map(t => (t.match(w.re) || []).length)), k = key + w.id, done = this.fired.get(k) || 0;
      if (n > done) { this.fired.set(k, n); this.onWord(w); }
    }
  }
}
