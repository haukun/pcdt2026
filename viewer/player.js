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

  // ---- URL設定（すべてミリ秒） ----
  const urlParams = new URLSearchParams(window.location.search);
  function positiveMsParam(name, fallback) {
    const value = Number(urlParams.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  // ---- 設定 ----
  const DURATION = positiveMsParam('duration', 20000); // 作品切り替え間隔(ms)
  const CROSSFADE = 900;                               // クロスフェード時間(ms)。CSSと合わせる
  const SETUP_TIMEOUT = 4000;                          // setup 完了待ちタイムアウト(ms)
  const TYPE_TOTAL = positiveMsParam('typing', 5000);  // ソース全文をタイプし終える目標時間(ms)
  const TYPE_MIN_DELAY = 8;                            // 1文字あたり最小間隔(ms)
  const TYPE_MAX_DELAY = 45;                           // 1文字あたり最大間隔(ms)
  const CHAR_LIMIT = 280;        // つぶやきProcessing の文字数上限
  const HASHTAG = '#つぶやきProcessing'; // 本文末尾に付けるハッシュタグ

  // ---- DOM ----
  const framesEl = document.getElementById('frames');
  const slotA = document.getElementById('slot-a');
  const slotB = document.getElementById('slot-b');
  const overlay = document.getElementById('overlay');
  const overlayVersion = document.getElementById('overlay-version');
  const overlayChars = document.getElementById('overlay-chars');
  const overlayTags = document.getElementById('overlay-tags');
  const tweetText = document.getElementById('tweet-text');
  const tweetImage = document.getElementById('tweet-image');
  const tweetDate = document.getElementById('tweet-date');
  const progressFill = document.getElementById('progress-fill');
  const counter = document.getElementById('counter');
  const notice = document.getElementById('notice');

  // ---- デバッグモード（?debug=1） ----
  const DEBUG = /(?:^|[?&])debug=1(?:&|$)/.test(location.search);

  // ---- 状態 ----
  let entries = (window.PREVIEW_MANIFEST || []).slice();
  const p5Files = window.PREVIEW_P5 || {}; // { version: "libs/p5-<v>.min.js" }
  const p5Cache = new Map();               // version -> p5 source text（取得済みをキャッシュ）
  let order = [];
  let orderPos = -1;
  let playCount = 0;

  let activeSlot = slotA;
  let nextSlot = slotB;

  let currentEntry = null;
  let currentSize = { w: 720, h: 720 };
  let advanceTimer = null;
  let rerunTimer = null; // draw無し作品を周期的に再実行するタイマー
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

  // デバッグ用: 現在位置から delta だけ進む/戻る（order 上を移動、両端は循環）
  function stepEntry(delta) {
    if (entries.length === 0) return null;
    orderPos = (orderPos + delta + order.length) % order.length;
    return entries[order[orderPos]];
  }

  // デバッグ用: entries のインデックスを直接指定して選ぶ（order 上の位置も合わせる）
  function pickEntryByIndex(entryIndex) {
    if (entries.length === 0) return null;
    const pos = order.indexOf(entryIndex);
    orderPos = pos >= 0 ? pos : 0;
    return entries[order[orderPos]];
  }

  // ---- iframe srcdoc 生成 ----
  // 作品のコードは無改変。p5本体はバージョンに対応するものを結合する。
  function buildSrcdoc(entry, p5Source) {
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
        // フルスクリーン切り替え直後は iframe の viewport が安定していない場合があるため、
        // 初回の短い通知は避け、少し待ってからサイズを確定する。
        window.addEventListener('load', function () {
          setTimeout(report, 300);
          setTimeout(report, 800);
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

  // ---- p5 本体をバージョン別に取得（キャッシュ付き） ----
  // manifest には p5 を含めず、p5Version → libs/p5-<version>.min.js を fetch する。
  async function loadP5(version) {
    if (p5Cache.has(version)) return p5Cache.get(version);
    const path = p5Files[version];
    if (!path) throw new Error('p5 バージョン未定義: ' + version);
    const res = await fetch(path);
    if (!res.ok) throw new Error('p5 取得失敗 (' + res.status + '): ' + path);
    const src = await res.text();
    p5Cache.set(version, src);
    return src;
  }

  // ---- slot に作品をロードし、setup 完了（サイズ取得）を待つ ----
  async function loadIntoSlot(slot, entry) {
    // 先に p5 本体を用意（取得失敗時は例外 → 呼び出し側で次候補へ）
    const p5Source = await loadP5(entry.p5Version);

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
      slot.srcdoc = buildSrcdoc(entry, p5Source);

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

  // ---- Twitter互換の文字数カウント ----
  // Twitter は「重み付き」でカウントする。次の範囲の文字は 1、それ以外（日本語などの
  // 全角・絵文字等）は 2 として数える。改行(\n)は 1。
  // 参考: twitter-text の weightedRanges デフォルト（1と数える範囲）。
  //   U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, U+2032–U+2037
  function twitterCharWeight(codePoint) {
    if (
      (codePoint >= 0x0000 && codePoint <= 0x10ff) ||
      (codePoint >= 0x2000 && codePoint <= 0x200d) ||
      (codePoint >= 0x2010 && codePoint <= 0x201f) ||
      (codePoint >= 0x2032 && codePoint <= 0x2037)
    ) {
      return 1;
    }
    return 2;
  }

  // 文字列の Twitter 重み合計（コードポイント単位。サロゲートペアは1コードポイント）
  function twitterWeight(str) {
    let w = 0;
    for (const ch of str) {
      w += twitterCharWeight(ch.codePointAt(0));
    }
    return w;
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
    // ハッシュタグ（#PCD2021 / #つぶやきProcessing など）を青く。
    // 入力はエスケープ済みなので、# に続く空白・タグ開始文字以外を1語として拾う。
    s = s.replace(/#[^\s<#&]+/g, '<span class="hashtag">$&</span>');
    return s;
  }

  // ---- オーバーレイ更新（本文は1文字ずつタイピング、文字数カウンターも連動） ----
  function showOverlay(entry) {
    overlayVersion.textContent = 'p5.js v' + (entry.p5Version || '?');

    // カードのメディア: グリッド作品は 1〜4.png を田の字、それ以外は canvas.png 1枚。
    const media = tweetImage.parentElement; // #tweet-media
    // 既存のグリッドをクリア
    const oldGrid = media.querySelector('.media-grid');
    if (oldGrid) oldGrid.remove();

    if (entry.gridImages && entry.gridImages.length) {
      tweetImage.style.display = 'none';
      tweetImage.removeAttribute('src');
      const grid = document.createElement('div');
      grid.className = 'media-grid';
      entry.gridImages.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        grid.appendChild(img);
      });
      media.appendChild(grid);
      media.style.display = '';
    } else if (entry.canvas) {
      tweetImage.style.display = '';
      tweetImage.src = entry.canvas;
      media.style.display = '';
    } else {
      tweetImage.style.display = '';
      tweetImage.removeAttribute('src');
      media.style.display = 'none';
    }
    // 投稿日時（フォルダ名 YYMMDD 由来）
    tweetDate.textContent = formatDate(entry.date);

    // イベント参加バッジ（DailyCodingChallenge / minacoding）
    overlayTags.innerHTML = '';
    (entry.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'badge badge-event';
      span.textContent = tag;
      overlayTags.appendChild(span);
    });

    // 改行は LF(1文字) 換算（つぶやきProcessing のカウント方式）。
    // 本文 = ソース + 改行 + [重複を除いた caption + 半角スペース] + ハッシュタグ。
    const code = (entry.code || '').replace(/\r\n/g, '\n').trim();

    // コード内にすでに含まれるハッシュタグはcaptionから除く。
    // 例: コード内に #minacoding がある作品には自動captionを重ねない。
    const rawCaption = entry.caption || '';
    const captionText = rawCaption
      .replace(/#[^\s#]+/g, (tag) => (code.includes(tag) ? '' : tag))
      .replace(/\s+/g, ' ')
      .trim();
    const caption = captionText ? captionText + ' ' : '';
    const alreadyHasTag = code.includes(HASHTAG);
    let fullText;
    if (alreadyHasTag) {
      // 既に #つぶやきProcessing がある場合は末尾タグを追加しない。
      fullText = caption ? code + '\n' + caption.trimEnd() : code;
    } else {
      fullText = code + '\n' + caption + HASHTAG;
    }

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
    const chars = Array.from(fullText); // サロゲートペア対応（コードポイント単位）
    const total = chars.length;
    // 各文字までの Twitter 重み累積（chars[0..k-1] の重み合計 = cumWeight[k]）
    const cumWeight = [0];
    for (let k = 0; k < total; k++) {
      cumWeight.push(cumWeight[k] + twitterCharWeight(chars[k].codePointAt(0)));
    }
    const totalWeight = cumWeight[total];
    let i = 0;

    // カウンターの分母右側（上限）は固定。まず総重みを表示。
    updateCharCount(totalWeight);

    // タイプ速度は「コードポイント数」に対して一定時間で打ち切る
    let delay = total > 0 ? TYPE_TOTAL / total : TYPE_MAX_DELAY;
    delay = Math.max(TYPE_MIN_DELAY, Math.min(TYPE_MAX_DELAY, delay));

    const render = (n, blink) => {
      const shown = chars.slice(0, n).join('');
      const caretClass = blink ? 'caret blink' : 'caret';
      tweetText.innerHTML = highlight(shown) + '<span class="' + caretClass + '">▍</span>';
      updateCharCount(cumWeight[n]); // タイピングに合わせて「重み」でカウント
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
    overlayChars.textContent = n + ' / ' + CHAR_LIMIT + ' 文字';
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

  // ---- 自動再生ループ: 次の作品を選んで再生（10秒後に自分を呼ぶ） ----
  function playLoop() {
    const entry = nextEntry();
    playEntry(entry);
  }

  // ---- 1作品を再生。debug 中は自動遷移タイマーを張らない ----
  async function playEntry(entry) {
    if (!entry) {
      showNotice('作品が見つかりません。build-manifest を実行してください。');
      return;
    }

    clearTimeout(rerunTimer); // 前作品の再実行タイマーを止める

    let size;
    try {
      size = await loadIntoSlot(nextSlot, entry);
    } catch (e) {
      // p5 取得失敗などはこの作品をスキップ。debug 中は自動で進めない。
      console.warn('[load failed] ' + entry.id + ':', e.message);
      if (!DEBUG) {
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(() => playLoop(), 400);
      }
      return;
    }

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
    if (DEBUG) syncDebugPanel();

    // 旧スロットは少し後にクリア（メモリ解放 & 実行停止）
    setTimeout(() => {
      nextSlot.classList.remove('active', 'fading-out');
      nextSlot.srcdoc = '';
      nextSlot.removeAttribute('src');
    }, CROSSFADE + 100);

    // 自動遷移は debug 中は無効。通常時のみ進捗バー＆10秒タイマー。
    if (DEBUG) {
      clearTimeout(advanceTimer);
      progressFill.style.width = '0%';
    } else {
      startProgress();
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => playLoop(), DURATION);
    }

    // draw 無しグリッド作品: 表示は続けたまま、rerunMs ごとに作品を再実行する
    // （毎回 random() で違う絵になる）。debug 中も再実行は行う。
    if (entry.rerunMs) {
      scheduleRerun(entry, activeSlot);
    }
  }

  // 同じ作品を「今アクティブなスロット」に再ロードして再実行（クロスフェードなし）。
  // slot が入れ替わっていたら（次作品へ進んだら）何もしない。
  function scheduleRerun(entry, slot) {
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(async () => {
      // 表示中の作品が変わっていたら中止
      if (currentEntry !== entry || slot !== activeSlot) return;
      try {
        await loadIntoSlot(slot, entry); // その場で作り直し = 再実行
      } catch (e) {
        console.warn('[rerun failed] ' + entry.id + ':', e.message);
        return;
      }
      // 表示継続中なら次の再実行を予約
      if (currentEntry === entry && slot === activeSlot) {
        scheduleRerun(entry, slot);
      }
    }, entry.rerunMs);
  }

  // ---- デバッグ操作: 前へ / 次へ / 指定作品へ ----
  function debugGo(delta) {
    clearTimeout(advanceTimer);
    playEntry(stepEntry(delta));
  }

  function debugJumpTo(entryIndex) {
    clearTimeout(advanceTimer);
    playEntry(pickEntryByIndex(entryIndex));
  }

  // ---- 起動 ----
  function start() {
    if (!Array.isArray(entries) || entries.length === 0) {
      showNotice('manifest.js が空です。ターミナルで `node viewer/build-manifest.mjs` を実行してください。');
      return;
    }

    // p5 バージョンが確定していない（null）作品、および対応する p5 ファイルが
    // 無いバージョンの作品は再生対象から除外する（オフラインで確実に動かすため）。
    const total = entries.length;
    entries = entries.filter(
      (e) => e.p5Version && p5Files[e.p5Version]
    );
    const dropped = total - entries.length;
    if (dropped > 0) {
      console.info(`[preview] バージョン未確定/未用意のため ${dropped} 作品を除外（対象 ${entries.length} / 全 ${total}）`);
    }
    if (entries.length === 0) {
      showNotice('再生できる作品がありません。p5-versions.json にバージョン範囲を設定し、libs/ に p5 を用意してから build-manifest を実行してください。');
      return;
    }

    if (DEBUG) {
      // デバッグ: シャッフルせず、entries の並び順（フォルダ名昇順）そのままで扱う。
      order = entries.map((_, i) => i);
      orderPos = -1;
      buildDebugPanel();
      debugGo(1); // 先頭から表示（自動遷移なし）
    } else {
      buildOrder();
      playLoop();
    }
  }

  // ============================================================
  // デバッグメニュー（?debug=1 のとき右上に表示）
  //   - 作品選択（ドロップダウンで任意の作品へジャンプ）
  //   - 前へ / 次へ
  //   - 自動遷移は無効（playEntry 側で DEBUG 判定）
  // ============================================================
  let dbgSelect = null;

  function buildDebugPanel() {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';

    const title = document.createElement('div');
    title.id = 'debug-title';
    title.textContent = 'DEBUG';
    panel.appendChild(title);

    // 作品選択
    dbgSelect = document.createElement('select');
    dbgSelect.id = 'debug-select';
    entries.forEach((e, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${e.title || e.id}  (p5 ${e.p5Version})`;
      dbgSelect.appendChild(opt);
    });
    dbgSelect.addEventListener('change', () => {
      debugJumpTo(parseInt(dbgSelect.value, 10));
    });
    panel.appendChild(dbgSelect);

    // 前へ / 次へ
    const nav = document.createElement('div');
    nav.id = 'debug-nav';
    const prev = document.createElement('button');
    prev.textContent = '‹ 前へ';
    prev.addEventListener('click', () => debugGo(-1));
    const next = document.createElement('button');
    next.textContent = '次へ ›';
    next.addEventListener('click', () => debugGo(1));
    nav.appendChild(prev);
    nav.appendChild(next);
    panel.appendChild(nav);

    // 位置表示
    const pos = document.createElement('div');
    pos.id = 'debug-pos';
    panel.appendChild(pos);

    document.body.appendChild(panel);

    // キーボード: ← → でも移動できるように
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') debugGo(-1);
      else if (ev.key === 'ArrowRight') debugGo(1);
    });
  }

  // デバッグUIを現在の再生位置に同期
  function syncDebugPanel() {
    if (!dbgSelect) return;
    const entryIndex = order[orderPos];
    dbgSelect.value = String(entryIndex);
    const pos = document.getElementById('debug-pos');
    if (pos) pos.textContent = `${orderPos + 1} / ${entries.length}`;
  }

  start();
})();
