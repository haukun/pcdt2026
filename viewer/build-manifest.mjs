// ============================================================
// PreviewViewer - Manifest Builder
// ------------------------------------------------------------
// sketches/ 配下の各作品フォルダを走査し、
//   - タイトル / 投稿日 / 作品コード全文
//   - p5 バージョン（p5-versions.json の範囲ルールで割り当て。範囲外は null）
// を収集して viewer/manifest.js を生成する。
//
// p5 本体は各作品に埋め込まず、バージョン別ローカルファイル
//   viewer/libs/p5-<version>.min.js
// を参照する（本番オフライン前提。外部CDNは一切使わない）。
// 各バージョンのファイルは事前にローカルへ用意しておくこと。
//
// 使い方:  node viewer/build-manifest.mjs
// ============================================================

import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKETCHES_DIR = join(ROOT, 'sketches');
const OUT_FILE = join(__dirname, 'manifest.js');
const LIBS_DIR = join(__dirname, 'libs'); // p5 のバージョン別ローカルファイル置き場
const VERSIONS_FILE = join(__dirname, 'p5-versions.json'); // バージョン割り当てルール
const CAPTIONS_FILE = join(__dirname, 'captions.json'); // 本文末尾への追加テキスト

// フォルダ名 "tp5_210101_ShineFlower" -> title "ShineFlower", id "tp5_210101_ShineFlower"
function deriveTitle(folderName) {
  // 先頭の tp5_ と続く数字連番を取り除いて、残りをタイトルにする
  const m = folderName.match(/^tp5_\d+_(.+)$/);
  if (m) return m[1];
  return folderName;
}

// フォルダ名の数字部分 "210101" (YYMMDD) を ISO日付 "2021-01-01" に変換。
// 解釈できない場合は null。
function deriveDate(folderName) {
  const m = folderName.match(/^tp5_(\d{6})/);
  if (!m) return null;
  const digits = m[1];
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = 2000 + yy; // 2桁年 -> 20xx
  const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return iso;
}

// p5-versions.json を読み、フォルダ名 → バージョンの解決関数を返す。
// ranges の from〜to（両端含む・フォルダ名の昇順比較）に version を割り当てる。
// どの範囲にも入らなければ null（バージョン未確定）。範囲重複時は先勝ち。
async function loadVersionResolver() {
  let rules = { ranges: [] };
  if (existsSync(VERSIONS_FILE)) {
    try {
      rules = JSON.parse(await readFile(VERSIONS_FILE, 'utf8'));
    } catch (e) {
      console.warn('p5-versions.json の読み込みに失敗（全作品 null 扱い）:', e.message);
    }
  }
  const ranges = Array.isArray(rules.ranges) ? rules.ranges : [];
  const resolve = (name) => {
    for (const r of ranges) {
      if (!r || !r.version) continue;
      const from = r.from ?? '';
      const to = r.to ?? '\uffff';
      if (name >= from && name <= to) return r.version;
    }
    return null;
  };
  const usedVersions = new Set(ranges.map((r) => r && r.version).filter(Boolean));
  const excludeSet = new Set(Array.isArray(rules.exclude) ? rules.exclude : []);
  const manualTags = rules.tags && typeof rules.tags === 'object' ? rules.tags : {};
  return { resolve, usedVersions, excludeSet, manualTags };
}

// captions.json を読み、id → 追加テキストのマップを返す。
async function loadCaptions() {
  if (!existsSync(CAPTIONS_FILE)) return {};
  try {
    const data = JSON.parse(await readFile(CAPTIONS_FILE, 'utf8'));
    return data.captions && typeof data.captions === 'object' ? data.captions : {};
  } catch (e) {
    console.warn('captions.json の読み込みに失敗（caption なしで続行）:', e.message);
    return {};
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function build() {
  if (!existsSync(SKETCHES_DIR)) {
    console.error('sketches フォルダが見つかりません:', SKETCHES_DIR);
    process.exit(1);
  }

  const dirents = await readdir(SKETCHES_DIR, { withFileTypes: true });
  const folders = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const { resolve: resolveVersion, usedVersions, excludeSet, manualTags } = await loadVersionResolver();
  const captions = await loadCaptions();

  const entries = [];
  const problems = [];
  let nullCount = 0;      // バージョン未確定（範囲外）の件数
  let excludedCount = 0;  // exclude 指定で除外した件数

  for (const folder of folders) {
    // 除外指定（重い/不具合など）の作品は manifest から外す
    if (excludeSet.has(folder)) {
      excludedCount++;
      continue;
    }

    const folderPath = join(SKETCHES_DIR, folder);

    // 作品コード: フォルダ内の同名 .js を最優先。
    // 無ければフォルダ直下の .js（libraries と一時ファイル p5js-temp-* を除く）を採用。
    let sketchFile = join(folderPath, `${folder}.js`);
    if (!existsSync(sketchFile)) {
      const files = await readdir(folderPath);
      const jsFiles = files.filter(
        (f) => f.endsWith('.js') && !f.startsWith('p5js-temp-')
      );
      if (jsFiles.length === 0) {
        problems.push(`${folder}: .js が見つかりません`);
        continue;
      }
      sketchFile = join(folderPath, jsFiles[0]);
    }

    let code;
    try {
      code = await readFile(sketchFile, 'utf8');
    } catch (e) {
      problems.push(`${folder}: 読み込み失敗 ${e.message}`);
      continue;
    }

    // p5 バージョンは範囲ルールで決定（範囲外は null = 未確定）
    const version = resolveVersion(folder);
    if (version === null) nullCount++;

    // 静止画（カードに埋め込む）: フォルダ内 canvas.png があれば viewer からの相対パスを記録
    const canvasPath = join(folderPath, 'canvas.png');
    const canvas = existsSync(canvasPath) ? `../sketches/${folder}/canvas.png` : null;

    // グリッド作品の判定:
    //   1.png〜4.png が揃い、かつ作品コードに draw が無い（setup だけ）作品。
    //   → カードは4枚を田の字表示、Viewer は 5秒ごとに iframe を作り直して再実行する。
    const hasGridImages = ['1.png', '2.png', '3.png', '4.png'].every((f) =>
      existsSync(join(folderPath, f))
    );
    const hasDraw = /\bdraw\s*=|\bfunction\s+draw\b|\bdraw\s*\(/.test(code);
    let gridImages = null;
    let rerunMs = null;
    if (hasGridImages && !hasDraw) {
      gridImages = [1, 2, 3, 4].map((n) => `../sketches/${folder}/${n}.png`);
      rerunMs = 5000; // 5秒ごとに再実行
    }

    // イベント参加フラグ（フォルダ名から判定）:
    //   dc_        → DailyCodingChallenge
    //   minacoding → minacoding
    // 例外: 2022年6月の dc_ は実際は minacoding イベント（dc としては扱わない）
    const isMinacoding202206 = /^tp5_2206\d\d_dc_/.test(folder);
    const tags = [];
    if (/(^|_)dc_/.test(folder) && !isMinacoding202206) tags.push('DailyCodingChallenge');
    if (/minacoding/i.test(folder) || isMinacoding202206) tags.push('minacoding');
    if (/CreativeCodingFireWorks/i.test(folder)) tags.push('CreativeCoding花火大会');
    // 2022年2月の DailyCodingChallenge は AltEdu2022 イベント参加
    const isAltEdu2022 = /^tp5_2202\d\d_dc_/.test(folder);
    if (isAltEdu2022) tags.push('AltEdu2022');
    // p5-versions.json の tags による手動指定（単発のイベントバッジなど）を追加
    if (Array.isArray(manualTags[folder])) {
      for (const t of manualTags[folder]) if (!tags.includes(t)) tags.push(t);
    }

    // entry には p5 本体を含めない。Viewer は p5Version から libs/p5-<version>.min.js を読む。
    entries.push({
      id: folder,
      title: deriveTitle(folder),
      date: deriveDate(folder),
      file: basename(sketchFile),
      p5Version: version, // null の場合は Viewer 側でスキップ
      canvas,
      gridImages, // 4枚の静止画（田の字表示用）。通常作品は null
      rerunMs,    // 再実行周期(ms)。draw 無しグリッド作品は 5000、通常は null
      tags, // イベント参加フラグ（バッジ表示用）
      // 本文末尾へ差し込む追加テキスト。captions.json 優先。
      // イベント由来のハッシュタグを前置する。tags を基準にするので、
      // minacoding バッジが付く作品（フォルダ名 minacoding / 2206の dc / 手動指定）は
      // すべて #minacoding が付く。AltEdu2022 は #AltEdu2022。
      caption: (() => {
        const base = captions[folder] || '';
        const prefixes = [];
        if (tags.includes('AltEdu2022')) prefixes.push('#AltEdu2022');
        if (tags.includes('minacoding')) prefixes.push('#minacoding');
        const parts = [];
        for (const part of [...prefixes, base].filter(Boolean)) {
          if (!parts.includes(part)) parts.push(part);
        }
        return parts.length ? parts.join(' ') : null;
      })(),
      code,
    });
  }

  // ---- 使用バージョンのローカル p5 ファイル存在チェック & PREVIEW_P5 生成 ----
  await mkdir(LIBS_DIR, { recursive: true });
  const p5Files = {};
  const missingLibs = [];
  for (const version of usedVersions) {
    const fname = `p5-${version}.min.js`;
    if (existsSync(join(LIBS_DIR, fname))) {
      p5Files[version] = `libs/${fname}`;
    } else {
      missingLibs.push(fname);
    }
  }

  // ---- manifest.js を出力 ----
  // window.PREVIEW_P5 = { "<version>": "libs/p5-<version>.min.js", ... }
  // window.PREVIEW_MANIFEST = [ { id, title, date, file, p5Version, canvas, code }, ... ]
  const header =
    '// AUTO-GENERATED by build-manifest.mjs — DO NOT EDIT BY HAND.\n' +
    `// Generated: ${new Date().toISOString()}\n` +
    `// Entries: ${entries.length}  /  p5 versions: ${Object.keys(p5Files).join(', ') || '(none)'}\n`;

  const body =
    'window.PREVIEW_P5 = ' + JSON.stringify(p5Files) + ';\n' +
    'window.PREVIEW_MANIFEST = ' + JSON.stringify(entries) + ';\n';

  await writeFile(OUT_FILE, header + body, 'utf8');

  console.log(`manifest.js を生成しました: ${entries.length} 作品`);
  console.log(`  バージョン確定: ${entries.length - nullCount} 件 / 未確定(null): ${nullCount} 件 / 除外: ${excludedCount} 件`);
  console.log(`  使用 p5 バージョン: ${Object.keys(p5Files).join(', ') || '(なし)'}`);
  if (missingLibs.length) {
    console.log(`  ⚠ ローカルに無い p5 ファイル（要ダウンロード）: ${missingLibs.join(', ')}`);
  }
  if (problems.length) {
    console.log(`--- スキップした作品 (${problems.length}) ---`);
    for (const p of problems) console.log('  ' + p);
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
