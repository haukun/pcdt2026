// ============================================================
// p5.js PreviewViewer - Player
// ------------------------------------------------------------
// - manifest.js (window.PREVIEW_MANIFEST) からランダムに1作品を選ぶ
// - 作品同梱の p5.min.js + 作品コードを iframe srcdoc で実行
//   （frameRate / createCanvas は一切上書きしない = 元の作品そのまま）
// - 作品の実キャンバスサイズを postMessage で受け取り、
//   画面に収まるよう中央スケール表示
// - 10秒（時間ms判定）経過で次作品へクロスフェード、無限ループ
// - タイトル / ソース / p5バージョン をオーバーレイ表示
// ============================================================

(function () {
  'use strict';

  // ---- 設定 ----
  const DURATION = 10000;        // 1作品の再生時間(ms)
  const CROSSFADE = 900;         // クロスフェード時間(ms)。CSSと合わせる
  const SETUP_TIMEOUT = 4000;    // setup 完了待ちタイムアウト(ms)
  const TYPE_TOTAL = 5000;       // ソース全文をタイプし終える目標時間(ms)
  const TYPE_MIN_DELAY = 8;      // 1文字あたり最小間隔(ms)
  const TYPE_MAX_DELAY = 45;     // 1文字あたり最大間隔(ms)
  const CHAR_LIMIT = 280;        // つぶやきProcessing の文字数上限
  const HASHTAG = '#つぶやきProcessing'; // 本文末尾に付けるハッシュタグ

  // ---- DOM ----
  const framesEl = document.getElementById('frames');
  const slotA = document.getElementById('slot-a');
  const slotB = document.getElementById('slot-b');
  const overlay = document.getElementById('overlay');
  const overlayVersion = document.getElementById('overlay-version');
  const overlayChars = document.getElementById('overlay-chars');
  const tweetText = document.getElementById('tweet-text');
  const tweetImage = document.getElementById('tweet-image');
  const tweetDate = document.getElementById('tweet-date');
  const progressFill = document.getElementById('progress-fill');
  const counter = document.getElementById('counter');
  const notice = document.getElementById('notice');

  // ---- 状態 ----
  let entries = (window.PREVIEW_MANIFEST || []).slice();
  let order = [];
  let orderPos = -1;
  let playCount = 0;

  let activeSlot = slotA;
  let nextSlot = slotB;

  let currentEntry = null;
  let currentSize = { w: 720, h: 720 };
  let advanceTimer = null;
  let setupTimer = null;
  let progressRAF = null;
  let typeTimer = null;
  let transitioning = false;

  // setup-complete を待っている slot と、そのコールバック
  let pendingSetup = null; // { slot, entry, size, resolve }

  function showNotice(msg) {
    notice.hidden = false;
    notice.textContent = msg;
  }

  // ---- シャッフル（順番の偏り防止：全部見てから再シャッフル） ----
  function buildOrder() {
    order = entries.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    orderPos = -1;
  }

  function nextEntry() {
    if (entries.length === 0) return null;
    orderPos++;
    if (orderPos >= order.length) {
      buildOrder();
      orderPos = 0;
    }
    return entries[order[orderPos]];
  }

  // ---- iframe srcdoc 生成 ----
  // 作品のコードは無改変。p5本体も作品同梱のものをそのまま使う。
  function buildSrcdoc(entry) {
    const p5Source = entry.p5Source;
    const userCode = entry.code;

    // </script> での早期終了を防ぐ
    const safeP5 = p5Source.replace(/<\/script>/gi, '<\\/script>');
    const safeCode = userCode.replace(/<\/script>/gi, '<\\/script>');

    // 作品側で createCanvas が呼ばれた実サイズを親に通知するブリッジ。
    // p5 の createCanvas をラップして幅・高さを拾う（挙動は変えない）。
    const bridge = `
      (function () {
        function report() {
          try {
            var c = document.querySelector('canvas');
            var w = c ? c.width : (window.width || 0);
            var h = c ? c.height : (window.height || 0);
            // WEBGL や pixelDensity で内部解像度が変わることがあるので
            // CSS 上の見た目サイズ（style/clientWidth）を優先
            if (c) {
              w = c.clientWidth || c.offsetWidth || w;
              h = c.clientHeight || c.offsetHeight || h;
            }
            parent.postMessage({ __pv: true, type: 'setup-complete', w: w, h: h }, '*');
          } catch (e) {
            parent.postMessage({ __pv: true, type: 'setup-complete', w: 0, h: 0 }, '*');
          }
        }
        // p5 のグローバル setup 実行後にキャンバスが生成される。
        // deviceready 相当として、複数回サイズ報告して確実にする。
        window.addEventListener('load', function () {
          setTimeout(report, 60);
          setTimeout(report, 300);
        });
        window.onerror = function (m, s, l) {
          parent.postMessage({ __pv: true, type: 'sketch-error', message: String(m), line: l }, '*');
        };
      })();
    `;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; overflow:hidden; background:#000; }
  canvas { display:block; }
</style>
</head>
<body>
<script>${safeP5}<\/script>
<script>${safeCode}<\/script>
<script>${bridge}<\/script>
</body>
</html>`;
  }

  // ---- slot に作品をロードし、setup 完了（サイズ取得）を待つ ----
  function loadIntoSlot(slot, entry) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (size) => {
        if (settled) return;
        settled = true;
        clearTimeout(setupTimer);
        resolve(size);
      };

      pendingSetup = {
        slot,
        entry,
        resolve: (size) => finish(size),
      };

      slot.removeAttribute('src');
      slot.srcdoc = buildSrcdoc(entry);

      // setup が来なくても既定サイズで続行
      setupTimer = setTimeout(() => {
        finish(null);
      }, SETUP_TIMEOUT);
    });
  }

  // ---- 右側領域に収まるよう #frames をサイズ＆スケール ----
  function fitStage(size) {
    const w = size && size.w ? size.w : 720;
    const h = size && size.h ? size.h : 720;
    currentSize = { w, h };

    framesEl.style.width = w + 'px';
    framesEl.style.height = h + 'px';

    // #stage の padding-left（カード領域）を差し引いた右側の実効幅で収める。
    // computed の padding-left はブラウザが px に解決してくれる。
    const stageEl = framesEl.parentElement;
    const cardZone = parseFloat(getComputedStyle(stageEl).paddingLeft) || 0;
    const availW = Math.max(1, window.innerWidth - cardZone);

    const margin = 0.92; // 余白
    const scale = Math.min(
      (availW * margin) / w,
      (window.innerHeight * margin) / h
    );
    framesEl.style.transform = 'scale(' + scale + ')';
  }

  window.addEventListener('resize', () => fitStage(currentSize));

  // ---- postMessage 受信 ----
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__pv !== true) return;

    if (data.type === 'setup-complete') {
      if (pendingSetup && event.source === pendingSetup.slot.contentWindow) {
        const size =
          data.w > 0 && data.h > 0 ? { w: data.w, h: data.h } : null;
        const cb = pendingSetup.resolve;
        pendingSetup = null;
        cb(size);
      }
    } else if (data.type === 'sketch-error') {
      console.warn('[sketch error]', currentEntry && currentEntry.id, data.message, 'line', data.line);
    }
  });

  // ---- 進捗バー ----
  function startProgress() {
    const start = performance.now();
    cancelAnimationFrame(progressRAF);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / DURATION);
      progressFill.style.width = (p * 100).toFixed(2) + '%';
      if (p < 1) progressRAF = requestAnimationFrame(tick);
    };
    progressRAF = requestAnimationFrame(tick);
  }

  // ---- 簡易シンタックスハイライト ----
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function highlight(code) {
    // まずエスケープ、その後トークンを span で装飾
    let s = escapeHtml(code);
    // コメント
    s = s.replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>');
    // 文字列
    s = s.replace(/(&#39;|&quot;|['"`])(?:\\.|(?!\1).)*\1/g, '<span class="s">$&</span>');
    // 数値
    s = s.replace(/\b(\d+\.?\d*)\b/g, '<span class="n">$1</span>');
    // キーワード
    s = s.replace(
      /\b(function|var|let|const|return|if|else|for|while|new|this|createCanvas|setup|draw|colorMode|background|fill|stroke|noStroke|noFill|push|pop|translate|rotate|scale|frameRate|blendMode)\b/g,
      '<span class="k">$1</span>'
    );
    // ハッシュタグ（#つぶやきProcessing）を青く
    s = s.replace(/(#つぶやきProcessing)/g, '<span class="hashtag">$1</span>');
    return s;
  }

  // ---- オーバーレイ更新（本文は1文字ずつタイピング、文字数カウンターも連動） ----
  function showOverlay(entry) {
    overlayVersion.textContent = 'p5.js v' + (entry.p5Version || '?');

    // 静止画（canvas.png）をカードに埋め込み
    if (entry.canvas) {
      tweetImage.src = entry.canvas;
      tweetImage.parentElement.style.display = '';
    } else {
      tweetImage.removeAttribute('src');
      tweetImage.parentElement.style.display = 'none';
    }
    // 投稿日時（フォルダ名 YYMMDD 由来）
    tweetDate.textContent = formatDate(entry.date);

    // 改行は LF(1文字) 換算（つぶやきProcessing のカウント方式）。
    // 本文はソース + 改行 + ハッシュタグ。
    const code = (entry.code || '').replace(/\r\n/g, '\n').trim();
    const fullText = code + '\n' + HASHTAG;

    overlay.classList.add('visible'); // 常に表示（自動で消さない）
    typeSource(fullText);
  }

  // "2021-01-01" -> "2021年1月1日"（Twitter風）
  function formatDate(iso) {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    return `${y}年${mo}月${d}日`;
  }

  // 全文を TYPE_TOTAL 目安でタイプする。1文字ごとにハイライト＆文字数更新。
  function typeSource(fullText) {
    clearTimeout(typeTimer);
    const chars = Array.from(fullText); // サロゲートペア対応
    const total = chars.length;
    let i = 0;

    // 打ち終わりの総文字数を先に確定（カウンターの分母右側に使う）
    updateCharCount(total);

    // 文字数に応じて1文字の間隔を決める（長文でも一定時間で打ち切れるよう調整）
    let delay = total > 0 ? TYPE_TOTAL / total : TYPE_MAX_DELAY;
    delay = Math.max(TYPE_MIN_DELAY, Math.min(TYPE_MAX_DELAY, delay));

    const render = (n, blink) => {
      const shown = chars.slice(0, n).join('');
      const caretClass = blink ? 'caret blink' : 'caret';
      tweetText.innerHTML = highlight(shown) + '<span class="' + caretClass + '">▍</span>';
      updateCharCount(n); // タイピングに合わせてカウンターを増やす
    };

    const step = () => {
      i++;
      render(i, false);
      if (i < total) {
        typeTimer = setTimeout(step, delay);
      } else {
        render(total, true); // 打ち終わりはカーソル点滅
        pulseCharCount();     // 打ち終わりにカウンターをひと弾ませる
      }
    };

    render(0, true); // 初期状態（0文字 + 点滅カーソル）
    typeTimer = setTimeout(step, delay);
  }

  // 文字数カウンター更新（現在打った文字数 / 上限）。超過で over クラス。
  function updateCharCount(n) {
    overlayChars.textContent = n + ' / ' + CHAR_LIMIT;
    overlayChars.classList.toggle('over', n > CHAR_LIMIT);
  }

  // タイピング完了時にカウンターをひと弾ませる（CSSアニメーションを1回だけ再生）
  function pulseCharCount() {
    overlayChars.classList.remove('pop');
    // クラス除去を確定させてから付け直し、アニメーションを再トリガー
    void overlayChars.offsetWidth; // 強制リフロー
    overlayChars.classList.add('pop');
  }

  function updateCounter(entry) {
    counter.textContent = entry.title || entry.id;
  }

  // ---- 1作品を再生 → 10秒後に次へ ----
  async function playLoop() {
    // 次の作品を nextSlot にロード
    const entry = nextEntry();
    if (!entry) {
      showNotice('作品が見つかりません。build-manifest を実行してください。');
      return;
    }

    const size = await loadIntoSlot(nextSlot, entry);

    // クロスフェード：旧をフェードアウト、新をフェードイン
    fitStage(size);
    activeSlot.classList.remove('active');
    activeSlot.classList.add('fading-out');
    nextSlot.classList.remove('fading-out');
    nextSlot.classList.add('active');

    // スロット入れ替え
    const tmp = activeSlot;
    activeSlot = nextSlot;
    nextSlot = tmp;

    currentEntry = entry;
    playCount++;

    showOverlay(entry);
    updateCounter(entry);
    startProgress();

    // 旧スロットは少し後にクリア（メモリ解放 & 実行停止）
    setTimeout(() => {
      nextSlot.classList.remove('active', 'fading-out');
      nextSlot.srcdoc = '';
      nextSlot.removeAttribute('src');
    }, CROSSFADE + 100);

    // 10秒後に次へ
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      playLoop();
    }, DURATION);
  }

  // ---- 起動 ----
  function start() {
    if (!Array.isArray(entries) || entries.length === 0) {
      showNotice('manifest.js が空です。ターミナルで `node viewer/build-manifest.mjs` を実行してください。');
      return;
    }
    buildOrder();
    playLoop();
  }

  start();
})();
