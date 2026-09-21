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
│       ├── sketch.properties     Processingメタ（Viewerは未使用）
│       └── libraries/p5.min.js   その作品が使うp5本体
├── resources/
│   └── guu.png                   カードのプロフィールアイコン
└── viewer/                       ★ Viewer本体
    ├── build-manifest.mjs        manifest生成スクリプト（Node）
    ├── manifest.js               自動生成物（window.PREVIEW_MANIFEST）
    ├── index.html                Viewerのページ
    ├── player.js                 再生ロジック
    ├── style.css                 スタイル
    └── SPEC.md                   このドキュメント
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
- 作品コード: フォルダ内の `<フォルダ名>.js` を最優先。無ければ最初の `.js`（libraries は除外）。
- p5本体: `<フォルダ>/libraries/p5.min.js`。無ければその作品はスキップ。
- 静止画: `<フォルダ>/canvas.png`。あれば相対パスを記録、無ければ `null`。

### 出力形式

`manifest.js` は `<script>` で直読みできるよう、次の形で出力する
（`fetch` を使わないので `file://` 直開きでも動く）。

```js
window.PREVIEW_MANIFEST = [ /* entry, entry, ... */ ];
```

### entry のスキーマ

| フィールド  | 型            | 内容 |
|-------------|---------------|------|
| `id`        | string        | フォルダ名（例 `tp5_210101_ShineFlower`） |
| `title`     | string        | `tp5_<数字>_` を除いた部分（例 `ShineFlower`） |
| `date`      | string\|null  | フォルダ名の `YYMMDD` → ISO日付 `YYYY-MM-DD`。無効なら `null` |
| `file`      | string        | 作品jsのファイル名 |
| `p5Version` | string        | 同梱 p5.min.js 先頭コメントから抽出（例 `0.10.2`）。取れなければ `unknown` |
| `canvas`    | string\|null  | 静止画の相対パス（例 `../sketches/<id>/canvas.png`）。無ければ `null` |
| `code`      | string        | 作品コード全文 |
| `p5Source`  | string        | 同梱 p5.min.js 全文（srcdoc 埋め込み用） |

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
| `DURATION`      | `10000`               | 1作品の再生時間(ms) |
| `CROSSFADE`     | `900`                 | クロスフェード時間(ms)。CSSの transition と一致させる |
| `SETUP_TIMEOUT` | `4000`                | 作品の setup 完了（サイズ通知）待ちのタイムアウト(ms) |
| `TYPE_TOTAL`    | `5000`                | 本文を打ち終える目標時間(ms) |
| `TYPE_MIN_DELAY`| `8`                   | 1文字あたり最小間隔(ms) |
| `TYPE_MAX_DELAY`| `45`                  | 1文字あたり最大間隔(ms) |
| `CHAR_LIMIT`    | `280`                 | 文字数カウンターの上限（超過で赤表示） |
| `HASHTAG`       | `#つぶやきProcessing` | 本文末尾に付けるハッシュタグ |

### 再生ループ

1. 起動時に manifest をシャッフルした再生順（`order`）を作る。
2. 1作品を iframe にロードして表示、`DURATION` 後に次へ。
3. 再生順を1周したら再シャッフルして継続（無限ループ）。
   → 短期間で同じ作品が偏って出るのを防ぐ。

### iframe による作品の隔離実行

- 作品は2枚の iframe（`slot-a` / `slot-b`）を交互に使い、`srcdoc` に
  「作品同梱の p5.min.js + 作品コード + サイズ通知ブリッジ」を埋め込んで実行する。
- iframe には `sandbox="allow-scripts"` を付与。
- **作品のコードも p5 本体も改変しない**。`frameRate` も `createCanvas` も上書きしない。
  → 元作品の FPS・キャンバスサイズ・見た目をそのまま再現する（FPS固定はしない）。
- `</script>` での早期終了だけは無害化のためエスケープする。

グローバルモードの作品（`setup=...`, `draw=...`, `t` などのグローバル変数）を使うため、
同一ページで複数作品を動かすと変数が衝突する。iframe 隔離でこれを回避している。

### キャンバスサイズと中央表示

- 各作品はサイズがまちまち（多くは 720×720 だが例外あり）。
- iframe 内のブリッジが `load` 後に canvas の見た目サイズ（clientWidth/Height優先）を
  `postMessage({ __pv:true, type:'setup-complete', w, h })` で親に通知する。
- 親は受け取ったサイズで `#frames` の実寸を設定し、画面に収まるよう
  `transform: scale()` で中央に等比スケール表示する（余白係数 0.92）。
- サイズ通知が来ない場合は `SETUP_TIMEOUT` 経過で 720×720 として続行。
- ウィンドウリサイズ時は現在サイズで再フィットする。

### postMessage プロトコル（親 ← iframe）

すべて `{ __pv: true, type, ... }` 形式。`__pv` フラグと送信元 window の一致で検証する。

- `setup-complete` … `{ w, h }`。作品のキャンバス実サイズ。
- `sketch-error` … `{ message, line }`。作品内エラー（console に警告出力するのみ）。

### 進捗バー

- 画面下部の `#progress-fill` が `DURATION` に対して 0→100% を `requestAnimationFrame` で描く。

---

## 5. Twitter風カード（オーバーレイ）

画面左上に固定表示。上から順に:

1. **タイトルバッジ**（`#counter`）: カードの上、カード幅内で中央揃え。作品タイトルを表示。
2. **カード**（`#tweet`）:
   - ヘッダー: アイコン `resources/guu.png` / 表示名「はぅ君」/ 青い認証マーク（インラインSVG）/ `@Hau_kun` / メニュー `···`
   - 本文（`#tweet-text`）: ソースコードをタイピング表示。末尾に改行 + `#つぶやきProcessing`。
   - メディア（`#tweet-image`）: 作品の `canvas.png`（無ければ非表示）。
   - 投稿日（`#tweet-date`）: `YYYY年M月D日` 形式。
   - フッター: 文字数カウンター（`#overlay-chars`）と p5バージョンバッジ（`#overlay-version`）。

表示名・アイコン・ハンドルは現状 **固定**（作者専用ビューアのため）。

### ソースのタイピング表示

- 本文テキスト = `code`（CRLF→LF正規化しトリム）+ `"\n"` + `HASHTAG`。
- 全体を `TYPE_TOTAL` 目安で打ち終えるよう、1文字の間隔を
  `TYPE_TOTAL / 文字数` で算出し `TYPE_MIN_DELAY`〜`TYPE_MAX_DELAY` にクランプ。
- 1文字進むたびに簡易シンタックスハイライトを再適用（コメント/文字列/数値/キーワード/ハッシュタグ）。
  部分文字列でもハイライト処理は例外を出さないことを確認済み。
- 末尾に点滅カーソル（▍）。打ち終わると点滅のまま残す。

### 文字数カウンター（つぶやきProcessing 準拠）

- 表示は `現在文字数 / CHAR_LIMIT`。**タイピングに連動して増える**。
- カウント対象は本文（ソース + 改行 + ハッシュタグ）。
- **改行は LF（1文字）換算**（CRLF を 2 と数えないよう正規化）。
  サロゲートペアは `Array.from` で1文字として数える。
- `現在文字数 > CHAR_LIMIT` で `.over` クラスが付き、緑→赤に変わる。

---

## 6. 実行方法

Viewer は `manifest.js` を `<script>` で読むため file:// でも一応動くが、
`canvas.png` や `guu.png` などの相対参照があるためローカルサーバー推奨。

```
# リポジトリルートで
npx http-server . -p 8123 -c-1
# → http://127.0.0.1:8123/viewer/ を開く
```

作品を追加・変更したら:

```
node viewer/build-manifest.mjs
```

---

## 7. 既知の制約・今後の検討事項

- **manifest.js が巨大化する**: 現状は各 entry に p5 本体全文（約540KB）を持たせている。
  作品ごとに同梱 p5 を埋め込むため、500作品では manifest が数百MB規模になりうる。
  → 対策案: p5 をバージョン単位で共有辞書化する / 作品コードだけ manifest に入れ
     p5 は別途キャッシュして srcdoc 生成時に結合する、など。
- **同梱 p5 バージョンの混在**: 作品ごとに p5 のバージョンが異なりうる前提。
  現状は各作品同梱のものをそのまま使うので問題ないが、共有化する場合は
  バージョン別に保持する必要がある。
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

- **Jujutsu（jj）を導入**。VisualJJ 拡張でバージョン管理を行う運用に移行（`.jj` を追加）。
- PreviewViewer 初版を実装（`viewer/` 一式）。ランダム10秒再生の無限ループ、
  iframe 隔離実行、Twitter風カード、ソースのタイピング表示、文字数カウンター（上限280）。
