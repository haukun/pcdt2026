# p5.js PreviewViewer 仕様書

`sketches/` にある「つぶやきProcessing」作品を、ランダムに1つずつ10秒間再生し続ける
無限プレビューViewer。各作品はTwitter風カードのオーバーレイ付きで表示される。

このドキュメントは Viewer の「現在の仕様」を記述する。今後の分析・拡張の起点として参照する。
実装を変更したら、このドキュメントも合わせて更新すること。

---

## 1. 目的とコンセプト

- 作者（はぅ君 / @Hau_kun）の p5.js 作品を、ギャラリーのように延々と流し見できるビューア。
- 1作品につき「タイトル・ソースコード・使用p5バージョン・投稿日」を提示し、10秒間再生する。
- ソースコードは Twitter に投稿したツイート風に、1文字ずつタイピング表示する。
- 作品数は現在5つだが、最終的に **500程度** まで増える想定。
- 最終実行環境は **Mac のブラウザ**（Windows でも開発・確認する）。

---

## 2. 全体構成

```
git_pcdt2026/
├── sketches/                     作品フォルダ群（Viewerの入力データ）
│   └── tp5_<YYMMDD>_<名前>/
│       ├── <同名>.js             作品コード（グローバルモードのp5スケッチ）
│       ├── index.html            作品単体で開くためのHTML（Viewerは未使用）
│       ├── canvas.png            サムネイル静止画（カードに埋め込む）
│       └── sketch.properties     Processingメタ（Viewerは未使用）
│       （libraries/ は削除済み。個別 index.html は使わない）
├── resources/
│   └── guu.png                   カードのプロフィールアイコン
└── viewer/                       ★ Viewer本体
    ├── build-manifest.mjs        manifest生成スクリプト（Node）
    ├── p5-versions.json          p5 バージョン割り当てルール（範囲指定・手動編集）
    ├── manifest.js               自動生成物（PREVIEW_P5 + PREVIEW_MANIFEST）
    ├── libs/                     p5 のバージョン別ローカルキャッシュ（Git管理外、別途コピー）
    │   └── p5-<version>.min.js
    ├── index.html                Viewerのページ
    ├── player.js                 再生ロジック
    ├── style.css                 スタイル
    ├── SPEC.md                   このドキュメント
    └── DATA_ISSUES.md            sketches データ例外の記録・対処状況
```

### データフロー

1. `build-manifest.mjs`（Node）が `sketches/` を走査し、各作品の情報を集めて
   `viewer/manifest.js` を生成する。
2. `viewer/index.html` が `manifest.js` → `player.js` の順に読み込む。
3. `player.js` が manifest を元に、iframe へ作品を流し込んで再生する。

Viewer 実行時はビルド不要。作品を追加・変更したときだけ manifest を再生成する。

---

## 3. manifest 生成（build-manifest.mjs）

### 実行方法

```
node viewer/build-manifest.mjs
```

### 走査ルール

- `sketches/` 直下のフォルダを各作品とみなす（名前順にソート）。
- 作品コード: フォルダ内の `<フォルダ名>.js` を最優先。無ければ直下の `.js` を採用するが、
  **一時ファイル `p5js-temp-*.js` は除外**する（作業中の残骸のため）。
- **p5 バージョン: `viewer/p5-versions.json` の範囲ルールで割り当てる**（下記）。
  フォルダ同梱の `libraries/p5.min.js` は保存時デフォルトで作品の実使用版と異なるため使わない。
  現在は `sketches` 内の libraries 自体を削除済み。p5本体は `viewer/libs/` のみを使う。
  範囲に含まれない作品は `p5Version = null`。
- 静止画: `<フォルダ>/canvas.png`。あれば相対パスを記録、無ければ `null`。
- 生成後、確定/未確定(null)の件数、使用バージョン、ローカルに無い p5 ファイル、
  スキップした作品をログに出す。

### p5 バージョン割り当てルール（p5-versions.json）

作品が実際に使う p5 バージョンは、作者が把握している情報を元に **フォルダ名の昇順に対する
範囲ルール**で管理する（同梱 p5 からは判定しない）。

```json
{
  "ranges": [
    { "from": "tp5_210101_ShineFlower", "to": "tp5_210305_PlaneDistortion", "version": "1.1.9" }
  ]
}
```

- `from`〜`to` はフォルダ名（両端含む・昇順比較）。その範囲の作品に `version` を割り当てる。
- 範囲が重複したら先に書いたものを優先。どの範囲にも入らなければ `null`。
- `version` はローカル `libs/p5-<version>.min.js` に対応する。**該当ファイルを事前に用意**すること
  （オンライン環境で取得 → `viewer/libs/` に配置 → Git管理外のまま本番フォルダへコピー）。
  build-manifest は未用意の版を警告する。
- 運用: 作者がバージョンを確認でき次第、範囲を追記し、対応する p5 を `libs/` に置いて再生成する。
  最終的に全作品のバージョンが確定する見込み。

### 作品の除外（exclude）

`p5-versions.json` の `exclude` にフォルダ名(id)を列挙すると、その作品は manifest から
外れ Preview で再生されない（重い・不具合などの作品を止めるため）。

```json
{ "exclude": ["tp5_210108_CircleSlice"], "ranges": [ ... ] }
```

- build-manifest が除外件数をログに出す。除外した作品は entry ごと生成対象外。
- プレビュー確認中に問題作品が見つかったら id を追記して再生成する運用。

### 本文末尾への追加テキスト（captions.json）

作品ごとに本文（ソース）末尾へ差し込むテキストを `viewer/captions.json` で管理する。

```json
{ "captions": { "tp5_210213_dc_Grass": "#PCD2021 草原" } }
```

- 本文は `コード + 改行 + caption + 半角スペース + #つぶやきProcessing` の順で組み立てる
  （caption とハッシュタグは同じ行）。
- caption 内のハッシュタグ（`#PCD2021` 等）も青くハイライトされ、文字数カウントにも含まれる。
- イベント由来ハッシュタグは tags を基準に自動前置する: `minacoding` バッジ作品には
  `#minacoding`、`AltEdu2022` バッジ作品には `#AltEdu2022`。captions.json の指定があれば併記。
- お題名の付与など、汎用の追加行に使える（id を足して再生成するだけ）。

### イベントバッジの手動指定（p5-versions.json の tags）

`tags`（自動判定: `dc_`/`minacoding`/`CreativeCodingFireWorks`）に加え、
`p5-versions.json` の `tags` で **id → バッジ名配列**を手動指定できる。

```json
{ "tags": { "tp5_210914_Pacman80080": ["800x80"] } }
```

- 単発のイベント（例: `800x80`）など、フォルダ名から自動判定できないバッジに使う。
- 自動判定と手動指定はマージされる（重複は除外）。

### 出力形式

`manifest.js` は `<script>` で直読みできるよう、次の2つを出力する。

```js
window.PREVIEW_P5 = { "1.1.9": "libs/p5-1.1.9.min.js", ... };
window.PREVIEW_MANIFEST = [ /* entry, entry, ... */ ];
```

- **p5 本体は manifest に埋め込まない**（肥大化回避、7章参照）。バージョン別に
  `viewer/libs/p5-<version>.min.js` を **事前にローカルへ用意**し、`PREVIEW_P5` でパスを対応づける。
- entry は `p5Version` だけを持ち、Viewer が `PREVIEW_P5[p5Version]` を fetch する。
- **オフライン本番前提**: p5 は外部CDNから読まない。必要な版はローカル `libs/` に置く。
- `PREVIEW_MANIFEST` は `<script>` で読めるので fetch 不要。p5 本体と `canvas.png` は
  fetch/相対参照するため **ローカルサーバー必須**（6章）。

### entry のスキーマ

| フィールド  | 型            | 内容 |
|-------------|---------------|------|
| `id`        | string        | フォルダ名（例 `tp5_210101_ShineFlower`） |
| `title`     | string        | `tp5_<数字>_` を除いた部分（例 `ShineFlower`） |
| `date`      | string\|null  | フォルダ名の `YYMMDD` → ISO日付 `YYYY-MM-DD`。無効なら `null` |
| `file`      | string        | 作品jsのファイル名 |
| `p5Version` | string        | 同梱 p5.min.js 先頭コメントから抽出（例 `0.10.2`）。取れなければ `unknown` |
| `canvas`    | string\|null  | 静止画の相対パス（例 `../sketches/<id>/canvas.png`）。無ければ `null` |
| `tags`      | string[]      | イベント参加フラグ。id に `dc_`→`DailyCodingChallenge`、`minacoding`→`minacoding`、`CreativeCodingFireWorks`→`CreativeCoding花火大会`、`tp5_2202xx_dc_`→`AltEdu2022`（+`#AltEdu2022`）、`tp5_2206xx_dc_`→`minacoding`（dc扱いせず+`#minacoding`）。加えて `p5-versions.json` の `tags` で手動指定 |
| `caption`   | string\|null  | 本文末尾へ差し込む追加テキスト（`captions.json` 由来）。無ければ `null` |
| `gridImages`| string[]\|null| draw 無し＋1〜4.png 揃いのグリッド作品の4画像パス。通常は `null` |
| `rerunMs`   | number\|null  | 再実行周期(ms)。グリッド作品は `5000`、通常は `null` |
| `code`      | string        | 作品コード全文 |

（p5 本体は entry に含めず、`PREVIEW_P5` 経由でバージョン別ファイルを参照する）

### 命名・日付の規約

- フォルダ名は `tp5_<YYMMDD>_<作品名>` を想定。
  - 例: `tp5_210101_ShineFlower` → title=`ShineFlower`, date=`2021-01-01`。
- 年は2桁を `20xx` として解釈する。
- 月日が範囲外（月>12 や 日>31）の数字は日付として無効 → `date=null`。
- ファイルのタイムスタンプは使わない（クローン日になり信用できないため）。

---

## 4. 再生ロジック（player.js）

### 設定定数（ファイル冒頭）

| 定数            | 現在値                | 意味 |
|-----------------|-----------------------|------|
| `DURATION`      | `20000`（URL `duration` で変更可） | 1作品の再生時間(ms) |
| `CROSSFADE`     | `900`                | クロスフェード時間(ms)。CSSの transition と一致させる |
| `SETUP_TIMEOUT` | `4000`               | 作品の setup 完了（サイズ通知）待ちのタイムアウト(ms) |
| `TYPE_TOTAL`    | `5000`（URL `typing` で変更可） | 本文を打ち終える目標時間(ms) |
| `TYPE_MIN_DELAY`| `8`                  | 1文字あたり最小間隔(ms) |
| `TYPE_MAX_DELAY`| `45`                 | 1文字あたり最大間隔(ms) |
| `CHAR_LIMIT`    | `280`                 | 文字数カウンターの上限（超過で赤表示） |
| `HASHTAG`       | `#つぶやきProcessing` | 本文末尾に付けるハッシュタグ |

### URLパラメーターによる速度・切り替え時間の変更

時間はすべてミリ秒で指定する。未指定・0以下・数値でない値はデフォルトに戻る。

```text
viewer/index.html?typing=7000&duration=30000
```

- `typing`: タイプライターの完了目標時間。デフォルト `5000`（約5秒）。
- `duration`: 作品の切り替え間隔。デフォルト `20000`（20秒）。
- `debug=1` と併用可能（例: `?debug=1&typing=8000&duration=30000`）。
- グリッド作品の再実行周期 `rerunMs=5000` は、このURL設定の影響を受けない。

### 再生ループ

1. 起動時に manifest をシャッフルした再生順（`order`）を作る。
2. 1作品を iframe にロードして表示、`DURATION` 後に次へ。
3. 再生順を1周したら再シャッフルして継続（無限ループ）。
   → 短期間で同じ作品が偏って出るのを防ぐ。

### iframe による作品の隔離実行

- 作品は2枚の iframe（`slot-a` / `slot-b`）を交互に使い、`srcdoc` に
  「p5.min.js（作品の `p5Version` に対応する版）+ 作品コード + サイズ通知ブリッジ」を
  埋め込んで実行する。
- p5 本体は `loadP5(version)` が `PREVIEW_P5[version]`（ローカル `libs/`）を fetch して取得し、
  `p5Cache` にバージョン単位でキャッシュする（同一バージョンは2回目以降 fetch しない）。
  取得失敗時はその作品をスキップして次へ進む。
- 起動時、**`p5Version` が null（未確定）、または対応する p5 ファイルが `PREVIEW_P5` に無い作品は
  再生対象から除外**する（除外件数を console に出す）。バージョンが確定し libs が揃った作品だけ再生する。
- iframe には `sandbox="allow-scripts"` を付与。
- **作品のコードも p5 本体も改変しない**。`frameRate` も `createCanvas` も上書きしない。
  → 元作品の FPS・キャンバスサイズ・見た目をそのまま再現する（FPS固定はしない）。
- `</script>` での早期終了だけは無害化のためエスケープする。

グローバルモードの作品（`setup=...`, `draw=...`, `t` などのグローバル変数）を使うため、
同一ページで複数作品を動かすと変数が衝突する。iframe 隔離でこれを回避している。

### キャンバスサイズと配置（右側領域の中央）

- 各作品はサイズがまちまち（多くは 720×720 だが例外あり）。
- iframe 内のブリッジが `load` 後 **300ms / 800ms** に canvas の見た目サイズ（clientWidth/Height優先）を
  `postMessage({ __pv:true, type:'setup-complete', w, h })` で親に通知する。
  フルスクリーン切り替え直後の viewport 未確定による初回サイズずれを避けるため、短すぎる初回通知は行わない。
- 親は受け取ったサイズで `#frames` の実寸を設定し、`transform: scale()` で等比スケール表示する。
- **作品は左側のカード領域を避け、右側の残り領域の中央に配置する**。
  - `#stage` に `padding-left: var(--card-zone)` を与えて flex 中央寄せを右側に寄せる。
  - `--card-zone`（`:root`）= `calc(148px + min(480px, 48vw))`。カード左端 `--card-left=124px`
    とカード幅 `min(480px, 48vw)`、右ギャップ24pxに対応し、カード幅と作品配置を連動させる。
  - `fitStage` のスケール計算は画面全幅ではなく `window.innerWidth − #stage の padding-left`
    （＝右側領域の実効幅、computed の padding-left を px で取得）を使う。余白係数 0.92。
- サイズ通知が来ない場合は `SETUP_TIMEOUT` 経過で 720×720 として続行。
- ウィンドウリサイズ時は現在サイズで再フィットする。

### グリッド作品（draw 無し・周期再実行）

「1.png〜4.png が揃い、かつ作品コードに `draw` が無い」作品は、setup を1回描いて止まる
静止的な作品（毎回 `random()` で違う絵になる）として扱う。build-manifest が自動判定し、
entry に `gridImages`（4画像）と `rerunMs`(5000) を付与する。

- **カード表示**: メディア部を4画像の 2×2 田の字にする。
- **再実行**: 表示は続けたまま `rerunMs` ごとに、アクティブな iframe をその場で再ロードして
  作品を再実行する（`scheduleRerun`）。クロスフェードはしない。10秒表示なら2バリエーション、
  表示時間を延ばせばその分バリエーションが増える。次作品へ進むと再実行タイマーは止まる。
- 判定漏れは手動で確認する運用（将来的に captions/exclude 同様、手動指定の余地あり）。

### postMessage プロトコル（親 ← iframe）

すべて `{ __pv: true, type, ... }` 形式。`__pv` フラグと送信元 window の一致で検証する。

- `setup-complete` … `{ w, h }`。作品のキャンバス実サイズ。
- `sketch-error` … `{ message, line }`。作品内エラー（console に警告出力するのみ）。

### 進捗バー

- 画面下部の `#progress-fill` が `DURATION` に対して 0→100% を `requestAnimationFrame` で描く。

---

## 4.9 背景装飾

`#stage` の背面に、CSSのみで軽量な装飾を重ねる（JS不要・オフラインOK）。

- ベース: `#stage` のダークネイビーの `radial-gradient`。
- `#stage::before`: ノイズドット（点描）。`radial-gradient` を `background-size: 22px` で敷き詰め。
- `#stage::after`: ビネット（周辺減光）。四隅を暗くして中央へ視線を集める。
- 装飾は `z-index: 0`、作品 `#frames` は `z-index: 1`、カード `#overlay` は `z-index: 20`。
  よって装飾は常に作品・カードの背面に位置し、視認性を妨げない。
- **額縁**: `#frames::before` を作品の外側（`inset: -5px`、極細）に置き、ダーク金属の枠＋
  斜めの光沢帯＋落ち影＋縁のハイライトで金属額縁を表現する。作品サイズに追従する。
  厚みは JS の `FRAME_BORDER(5)` と揃える。

---

## 4.95 美術館風タイトルプレート

作品タイトルとタグを、美術館の解説プレート風に **画面下部へ固定**表示する（`#plate`）。

- 位置は画面基準で固定: `left: var(--card-zone)` 〜 `right: 0` の右側領域中央、`bottom: 28px`。
  作品の解像度・スケールが変わっても位置は動かない。
- プレート幅は **作品の表示幅（額縁込み）に一致**（JSが `--art-width` を毎フレーム設定）。
  プレートは作品と同じ中心（右側領域の中央）に置く。
- **タイトル板**（`.plate-board` / `#plate-title`）はプレート幅の**中央**（`display:flex` +
  `margin-left/right:auto`）。見た目は **明るいシルバー金属＋斜め光沢帯**、文字は
  **セリフ体イタリック**（OS標準フォント、オフライン対応）の刻字風。
- **バッジ群**（`#plate-tags`）は**作品枠の右端**に絶対配置・**上端揃え**、最大2行のグリッドで
  縦→左に折り返す。絶対配置のためバッジの幅・個数はタイトルの中央位置に影響しない。
  バッジは **ダークメタリック**で、イベント別に色分け:
  minacoding=ダークブルー / DailyCodingChallenge=ダークパープル / AltEdu2022=ダークグリーン /
  CreativeCoding花火大会=ダークレッド / p5バージョン=無彩色ガンメタル（`.tag-*` クラス）。
- **作品に重ねない/縦中央に配置**: 利用可能領域は「上余白 `TOP_MARGIN(24)`（カードと揃える）〜
  下部 `PLATE_RESERVE(84)`」。`fitStage` は額縁厚み `FRAME_BORDER(5px)` を織り込み、
  `scale` は「作品＋額縁（上下左右）」がこの領域（横は実効幅×0.98）に収まる値にする。
  作品はこの領域の**縦中央**に置く（`#frames` の `margin-top = FRAME_BORDER×scale +
  (availH − 表示高さ)/2`）。領域いっぱいの作品は実質上端24px、小さい作品は上下均等の余白になる。
- タイトル・タグ・p5バージョンは **プレート領域にのみ表示**。Twitter風カードからは
  タイトル（旧 `#counter`）・イベントタグ・p5バージョンバッジをすべて廃止した。

---

## 5. Twitter風カード（オーバーレイ）

画面左上に固定表示。**カード（`#tweet`）** の内容（上から）:

- ヘッダー: アイコン `resources/guu.png` / 表示名「はぅ君」/ 青い認証マーク（インラインSVG）/ `@Hau_kun` / メニュー `···`
- 本文（`#tweet-text`）: ソースコードをタイピング表示。末尾に改行 + `#つぶやきProcessing`。
- 文字数カウンター行（`#tweet-charline`）: 本文の直後、右寄せ。文字数カウンター
  （`#overlay-chars`。バッジではなく下線付きテキスト）。
- メディア（`#tweet-media`）: 通常は `canvas.png` 1枚（`#tweet-image`）。
  グリッド作品（`gridImages` あり）は 1〜4.png を **2×2の田の字**（`.media-grid`）で表示。
- 日付行（`#tweet-metaline`）: 投稿日（`#tweet-date`、`YYYY年M月D日`）のみ。
- 作品タイトル・イベントタグ・p5バージョンはカードには表示しない（美術館プレート `#plate` に集約）。
   （バッジ類はカード外＝上記2に移動。p5バージョン + イベントバッジ）

表示名・アイコン・ハンドルは現状 **固定**（作者専用ビューアのため）。

### ソースのタイピング表示

- 本文テキスト = `code`（CRLF→LF正規化しトリム）+ `"\n"` + `caption`（あれば + 半角スペース）+ `HASHTAG`。
  caption とハッシュタグは同じ行に並ぶ（例: `#PCD2021 草原 #つぶやきProcessing`）。
- 例外: **コード内に既に `#つぶやきProcessing` を含む作品**（コードで文字列として使っている等）は、
  末尾ハッシュタグを追記しない（重複防止）。caption があればそれだけ添える。
- caption 内のハッシュタグ（`#minacoding`、`#AltEdu2022` 等）がコード内に既に含まれる場合も、
  そのcaption側のハッシュタグを重複追記しない。
- ハッシュタグ（`#PCD2021` / `#つぶやきProcessing` など `#語` 全般）は青くハイライトする。
- 全体を `TYPE_TOTAL` 目安で打ち終えるよう、1文字の間隔を
  `TYPE_TOTAL / 文字数` で算出し `TYPE_MIN_DELAY`〜`TYPE_MAX_DELAY` にクランプ。
- 1文字進むたびに簡易シンタックスハイライトを再適用（コメント/文字列/数値/キーワード/ハッシュタグ）。
  部分文字列でもハイライト処理は例外を出さないことを確認済み。
- 末尾に点滅カーソル（▍）。打ち終わると点滅のまま残す。

### 文字数カウンター（Twitter 互換の重み付きカウント）

- 表示は `現在カウント / CHAR_LIMIT`。**タイピングに連動して増える**。
- カウント対象は本文（ソース + 改行 + ハッシュタグ `#つぶやきProcessing`）。
- **Twitter の重み付きカウント**に準拠する:
  - **半角（ラテン・一般記号など）= 1、全角（日本語・絵文字など）= 2**。
  - 1 と数える範囲は twitter-text デフォルト（U+0000–U+10FF, U+2000–U+200D,
    U+2010–U+201F, U+2032–U+2037）。それ以外は 2（`twitterCharWeight`）。
  - 改行は LF = 1（CRLF を 2 と数えないよう `\r\n` を `\n` に正規化）。
  - サロゲートペアはコードポイント単位で1回として重みを加算。
- `重み合計 > CHAR_LIMIT`（280）で `.over` クラスが付き、緑→赤に変わる。
- 注意: 日本語を含む作品は重みが増えるため、以前の単純文字数より大きくなる。
- `現在文字数 > CHAR_LIMIT` で `.over` クラスが付き、緑→赤に変わる。
- **タイピング完了時のポップ演出**: 打ち終わった瞬間、カウンターに `.pop` クラスを付けて
  CSSアニメーション（`count-pop`: 約0.6秒、拡大して緑に発光し弾んで戻る）を1回再生する。
  作品が切り替わるたびに再生させるため、クラス除去 → 強制リフロー → 付与で再トリガーする
  （`pulseCharCount`）。

---

## 5.5 デバッグモード（?debug=1）

URL に `?debug=1` を付けると（例 `viewer/index.html?debug=1`）デバッグモードになる。

- 右上に **デバッグメニュー**（`#debug-panel`）を表示:
  - 作品選択ドロップダウン（`#debug-select`）: 全対象作品から任意にジャンプ。
    表示は `番号. タイトル (p5 <version>)`。
  - 前へ / 次へ ボタン（`#debug-nav`）。← / → キーでも移動可。
  - 現在位置表示（`#debug-pos`、`n / 全件`）。
- **自動遷移を無効化**: 10秒タイマーと進捗バーを止め、手動操作でのみ作品を切り替える。
- 再生順は**シャッフルせず**、フォルダ名の昇順そのまま（選択・前後移動・バージョン境界の確認がしやすい）。
- 通常モード（debug なし）はランダム・10秒・無限ループのまま。

---

## 6. 実行方法

Viewer は `manifest.js` を `<script>` で読むが、p5 本体を `fetch`（`libs/p5-*.min.js`）
するため、および `canvas.png` / `guu.png` の相対参照があるため **ローカルサーバー必須**
（file:// 直開きは fetch が CORS で失敗する）。

### 起動スクリプト（推奨）

リポジトリルートに起動スクリプトを用意している。サーバーを起動し、HTTP応答を確認してから
既定ブラウザでViewerを開く（初回の `npx` ダウンロード中に早く開きすぎない）。
macOSではGoogle Chrome / Chromium / Edgeがインストールされていれば、ブラウザ実行ファイルを直接
`--kiosk` + `--start-fullscreen` で起動し、タブバー・ツールバーを隠す。既存ブラウザプロセスの
影響を避けるため一時プロファイルを使用する。それ以外の環境では既定ブラウザで通常起動する。
（ポート 8125、キャッシュ無効 `-c-1`。Node.js が必要）

- Windows（エクスプローラー）: `start-viewer.cmd` をダブルクリック
- Windows（PowerShell）: `.\start-viewer.ps1`
  （ブロックされる場合: `powershell -ExecutionPolicy Bypass -File .\start-viewer.ps1`）
- macOS / Linux: 初回のみ `chmod +x start-viewer.sh` → `./start-viewer.sh`

停止は起動したウィンドウで Ctrl+C。

### 手動起動

```
# リポジトリルートで
npx http-server . -p 8125 -c-1
# → http://127.0.0.1:8125/viewer/ を開く（debug は末尾に ?debug=1）
```

作品を追加・変更したら manifest を再生成する:

```
node viewer/build-manifest.mjs
```

---

## 7. 既知の制約・今後の検討事項

- **manifest.js の肥大化（対処済み）**: 当初は各 entry に p5 本体全文を持たせており、
  約1000作品では `JSON.stringify` の上限を超えて生成が失敗した。現在は p5 を
  バージョン別ファイル `viewer/libs/p5-<version>.min.js` に分離し、entry は `p5Version`
  だけ持つ（3バージョン=3ファイル、計約2.2MB）。manifest.js は約0.45MB に収まる。
- **p5 バージョンは範囲ルールで管理（進行中）**: 作品が実際に使う版は同梱 p5 では判定できず、
  `p5-versions.json` に範囲を追記して確定させる。現時点で確定は
  `tp5_210101_ShineFlower`〜`tp5_210305_PlaneDistortion` の 64 件（1.1.9）のみ。
  残りは null で再生対象外。バージョンが埋まるにつれ再生対象が増える。
- **必要な p5 のローカル用意**: 範囲で使う版は `libs/p5-<version>.min.js` を事前に置く。
  これらのキャッシュは **Git管理外** なので、Gitから取得するだけでは足りない。
  Mac等の本番環境へは `viewer/libs/` フォルダを別途コピーする。無い版は build-manifest が警告し、
  その版の作品は再生されない。
- **P5（p5 欠落作品）は範囲ルール化と libraries 削除で解消**: 同梱p5を読まず、`viewer/libs/`
  のバージョン別キャッシュだけを参照するため、sketches内の `libraries/` は不要。
- **`sketches/` データの例外**: フォルダ名とjs名の不一致・入れ子・一時ファイル・
  Python作品などの例外は `viewer/DATA_ISSUES.md` に記録。多くは修正済み。
- **表示名・アイコンが固定**: 複数作者に対応する場合は entry にメタを持たせる拡張が必要。
- **シンタックスハイライトは簡易実装**: 正規表現ベースで、複雑な構文は完全ではない。
- **セキュリティ**: iframe は `sandbox="allow-scripts"` のみ。自作作品専用のため
  現状は最小限。外部投稿を受け付ける場合は fetch/XHR 無効化などの追加防御を検討。

---

## 8. バージョン管理（Jujutsu / jj）

このリポジトリは **Jujutsu（jj）** で管理する。`.jj` と `.git` が併存する
colocated リポジトリで、Git リポジトリと同じ作業ツリー上で jj を使う。
VS Code では **VisualJJ** 拡張から操作する。

- リポジトリ構成: `.jj/`（Jujutsu 管理データ）と `.git/`（Git バックエンド）が同居。
- 既存の Git ツールや GitHub との連携はそのまま利用できる（jj が Git を裏で扱う）。
- 履歴の閲覧・変更・コミット相当の操作は VisualJJ から行う。

### 管理対象ルール（.gitignore）

- **`sketches/` の中身は git 管理しない**（`.gitignore` で除外）。作品原本は別管理しており、
  容量削減のため。Mac へは **フォルダごとコピー** して持っていく運用なので、
  実行環境には sketches（canvas.png 含む）が手元にある前提。
- ただし **`sketches/` フォルダ自体は残す**。git は空フォルダを追跡できないため、
  `sketches/.gitkeep` をプレースホルダとして置き、`.gitignore` は
  `sketches/*` で中身を無視しつつ `!sketches/.gitkeep` で例外的に追跡する。
- ほかに `node_modules/`、`.DS_Store`、`Thumbs.db` を除外。
- **`viewer/libs/` も git 管理しない**（`.gitignore` で除外）。p5本体のキャッシュは容量・更新頻度の
  ため別管理とし、Mac等の実行環境へ `viewer/libs/` フォルダごとコピーする。
- 生成物 `viewer/manifest.js` は **バージョン管理に含める（コミットする）**。
  作品を追加・変更したら `node viewer/build-manifest.mjs` で再生成し、
  更新後の manifest.js もコミットする。
- 注意: `sketches/` が既に追跡済みの状態で `.gitignore` に足しても無視されない。
  その場合は `git rm -r --cached sketches`（ディスク上のファイルは消えない）で
  追跡から外してから ignore を効かせる。

---

## 9. 変更履歴の残し方

このViewerの仕様を変えたら、本ドキュメントの該当節を更新する。
定数の変更（再生時間・文字数上限など）は「4. 設定定数」の表を最新に保つこと。
大きめの変更は下の「変更履歴」に1行追記する。

### 変更履歴

- **見た目のブラッシュアップ（美術館テイスト）**: 背景にノイズドット＋ビネット。作品に金属光沢の
  細額縁（5px）。下部の美術館タイトルプレートを、明るいシルバー光沢＋セリフ体イタリックに。
  タグ/バージョンをダークメタリックのバッジ化し、イベント別に色分け（青/紫/緑/赤＋ガンメタル）、
  作品枠の右端に上端揃え・最大2行で配置。作品は上余白をカードと揃えつつ利用可能領域の縦中央に配置。
- **URLパラメーター**: `typing`（既定5000）と `duration`（既定20000）で速度・切替時間を変更可能に。
- **起動スクリプト**: Win（cmd/ps1）・macOS/Linux（sh、kiosk起動）を用意。サーバー起動を待って開く。
- **sketches内の `libraries/` を削除**: Previewは `viewer/libs/` のローカルp5キャッシュだけを使い、
  個別作品の `index.html` は運用しないため、992個・約720MBの重複p5ファイルを削除。
  `viewer/libs/` はGit管理外なので、本番/Macへは別途コピーする。
  - 同梱 `libraries/p5.min.js` は保存時デフォルトで実際の使用版と異なると判明。
    版判定をやめ、`viewer/p5-versions.json` の範囲ルールで割り当てる方式に変更。
  - 使う版は外部CDNではなくローカル `libs/p5-<version>.min.js` を参照（本番はネット接続不可）。
    1.1.9 を取得済み。`tp5_210101_ShineFlower`〜`tp5_210305_PlaneDistortion`(64件)=1.1.9 を登録。
  - `p5Version` が null（未確定）または libs 未用意の作品は再生対象から除外。
  - 旧・同梱由来の libs（0.10.2/1.4.0/1.5.0）は不正確なため削除。
- **全作品（約1000）投入に伴うデータ整備と肥大化対策**:
  - `sketches` データの例外を調査し `viewer/DATA_ISSUES.md` に記録。
    P1（フォルダ名とjs名の不一致43件）をフォルダ名を正としてリネーム＋index.html更新、
    P2（一時ファイル）を build-manifest で除外、P3（入れ子2件）を直下へ移動、
    P4（Python作品1件）を削除。P5（p5欠落2件）は未対処でスキップ中。
  - **manifest 肥大化対策**: p5 本体を entry から分離し `viewer/libs/p5-<version>.min.js`
    に書き出す方式へ変更。manifest は `PREVIEW_P5` + `PREVIEW_MANIFEST` の2本立て。
    player は `p5Version` から p5 を fetch＆キャッシュして srcdoc に結合。
    現在 992 作品を生成（manifest ≈ 0.45MB）。
- **`.gitignore` 整備**: `sketches/` の中身を除外（原本は別管理）。フォルダ自体は
  `sketches/.gitkeep` で残す。`viewer/libs/` も除外し、p5キャッシュは別途コピーする。
  `node_modules/`・`.DS_Store`・`Thumbs.db` も除外。`viewer/manifest.js` はコミット対象。
- **Jujutsu（jj）を導入**。VisualJJ 拡張でバージョン管理を行う運用に移行（`.jj` を追加）。
- **UI 調整**: 作品を右側領域の中央に配置（カードと重ならないよう `--card-zone` 分を確保）。
  タイピング完了時に文字数カウンターをポップさせる演出を追加。
  タイトルバッジをカードの上（中央揃え）に移動。
- **文字数カウンターの上限を 280 に変更**（本文＝ソース＋改行＋`#つぶやきProcessing`、
  改行はLF換算）。カウンターはタイピングに連動して増加。
- **カードに投稿日を追加**（フォルダ名の `YYMMDD` 由来）。静止画（canvas.png）を埋め込み。
- PreviewViewer 初版を実装（`viewer/` 一式）。ランダム10秒再生の無限ループ、
  iframe 隔離実行、Twitter風カード、ソースのタイピング表示。
