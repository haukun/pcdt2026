# sketches データの例外パターン記録（全995作品の調査結果）

全スケッチ（995フォルダ、`.gitkeep` 除く）を格納した際の、`build-manifest.mjs` の
現行前提から外れるケースの一覧。**すべて対処する**方針。対処が済んだら各項目にチェックを入れ、
SPEC.md（3章 走査ルール / 7章 制約）へ反映する。

調査日時点の作品数: **995**（`sketches/` 直下フォルダ、`.gitkeep` 除く）

## 現行 build-manifest.mjs の前提（おさらい）

- フォルダ名 `tp5_<YYMMDD>_<名前>`
- 作品コード = `<フォルダ名>.js`（無ければフォルダ直下の最初の `.js`、libraries 除外）
- p5本体 = `<フォルダ>/libraries/p5.min.js`
- 静止画 = `<フォルダ>/canvas.png`（無ければ `canvas: null`）
- 日付 = フォルダ名の `YYMMDD`

---

## 例外パターン一覧

### P1. フォルダ名と js ファイル名が食い違う（43件）→ 対処済み

フォルダ名の `<フォルダ名>.js` が存在せず、タイポ・日付/年ズレ・イベントフラグ欠落
（`dc_`=dailycoding, `minacoding`=minacodingイベント参加フラグ）などで別名 js が1つあった。

**方針: フォルダ名を正**として、js を `<フォルダ名>.js` にリネームし、
各作品の `index.html` の js 参照（`libraries/p5` 以外の `src`）も新名に張り替えた。
多くの index.html はもともと存在しない `p5js-temp-*.js` / `sketch_XXXa.js` を参照して
壊れていたが、この張り替えで単体でも動くよう修復された。

- 決定事項: 年ズレ（例 `220102` ⟵ `210102`）はフォルダ名（2022）を正。
  `dc_` / `minacoding[数字]` はイベント参加フラグでフォルダ名が正。
- 実施: 43件を一括リネーム＋index.html更新（`git` 管理外の原本を直接修正）。

対処: [x] 完了。全43件で `<フォルダ名>.js` が存在し、index.html も新名を参照することを確認。

---

### P2. 一時ファイル `p5js-temp-*.js` が本体と混在（1件）

- `tp5_210324_WhiteTorus`
  - `p5js-temp-tp5_210324_WhiteTorus1441953794807671160.js`（一時ファイル・除外対象）
  - `tp5_210324_WhiteTorus.js`（本体）

対処: [x] 完了。`build-manifest.mjs` の js 候補から `p5js-temp-*.js` を除外
（本体があるためファイル自体は残す）。加えて P1 対応で `<フォルダ名>.js` が
存在するようになったため、同名優先で本体が選ばれる。

---

### P3. 作品一式がサブフォルダに入れ子（2件）→ 対処済み

フォルダ直下ではなく、1階層下のサブフォルダに js・p5・index.html 一式があった。

- `tp5_210220_SymmetricCircle` → `sketch_210502a/` の中身を直下へ移動。
  js を `tp5_210220_SymmetricCircle.js` にリネームし index.html 参照も更新。
- `tp5_211206_ShineLace` → 直下の壊れた一式（`tp5_alter.js` を参照する index.html 等）を
  破棄し、入れ子 `tp5_ShineLace/` の正しい一式を直下へ。js を
  `tp5_211206_ShineLace.js` にリネーム。canvas.png / half.png は保持。

対処: [x] 完了。両件とも標準構成（直下に `<フォルダ名>.js` + `libraries/p5.min.js`）に修正。
入れ子は全作品で 0 件になったことを確認。

---

### P4. Python mode（`.pyde`）で p5.js ではない（1件）→ 対処済み

- `tp5_230613_minacoding_MapGen4Python`
  - `tp5_230613_MapGen4Python.pyde` のみ（Processing Python mode）。p5.js では実行不可。

対処: [x] 完了。フォルダごと削除（Python チャレンジ作品のため本プロジェクトでは対象外）。
削除により総フォルダ数は 995 → 994。

---

### P5. `libraries/p5.min.js` が欠落（4件）→ 解消（方式変更により無関係化）

- `tp5_210220_SymmetricCircle` … P3 で解決済み。
- `tp5_230613_minacoding_MapGen4Python` … P4 で削除済み。
- `tp5_220214_LoveColor` / `tp5_230629_FruitLeaves` … `libraries` 欠落だが、

**方式変更で p5 バージョンは同梱ファイルから判定しなくなった**（`viewer/p5-versions.json` の
範囲ルールで割り当て、p5 本体はローカル `libs/` を参照）。よって同梱 p5 の有無は
Viewer 動作に無関係になり、P5 は解消。これら2作品もバージョン範囲が確定すれば通常どおり再生される。

対処: [x] 解消（build-manifest は同梱 p5 を読まない）。

---

### P6. `canvas.png` が無い（現在のPreview対象では2件）

`canvas.png` が無い作品は `canvas: null` となり、カードの静止画を非表示にする。
Viewerの実行自体には影響しない。グリッド作品（1〜4.png）は `canvas.png` が無くても
`gridImages` を表示する。

現在のPreview対象（manifest 927件）で、canvas.pngもグリッド画像も無い作品:
- `tp5_220606_dc_SliderFlower`
- `tp5_220717_SpiralZone`

過去にcanvas.pngが無かったが、後から追加され解消した作品:
- `tp5_230919_OverlappingTriangles`

対処: [x] 仕様どおり静止画なしとして許容。必要になった作品は canvas.png を追加して
`node viewer/build-manifest.mjs` を再実行する。

---

## p5 バージョンについて（重要な前提の訂正）

当初は各フォルダ同梱 `libraries/p5.min.js` の先頭コメントからバージョンを集計していたが
（0.10.2 / 1.4.0 / 1.5.0 の3種に分散）、**これは p5エディターの保存時デフォルトであり、
作品が実際に使う版とは異なる**ことが判明した（作者談。実際は例えば 1.1.9 を使う作品がある）。

そのため:
- 同梱 p5 からの版判定は廃止。
- 作品が実際に使う版は `viewer/p5-versions.json` の**範囲ルール**（フォルダ名昇順）で管理し、
  作者の確認に合わせて順次確定させる。
- 使う版の p5 本体は**ローカル** `viewer/libs/p5-<version>.min.js` に置く（本番オフライン）。
  p5.sound などアドオンは使わない。

現在確定している範囲:
| from | to | version | 件数 |
|------|----|---------|------|
| tp5_210101_ShineFlower | tp5_210305_PlaneDistortion | 1.1.9 | 64 |
| tp5_210306_CrystalBall | tp5_210506_ConnectorSpin | 1.2.0 | 50 |
| tp5_210507_PeacockFeather | tp5_210710_GeneratedStar | 1.3.1 | 50 |
| tp5_210711_Burning | tp5_220706_ColorWalk | 1.4.0 | 241 |
| tp5_220707_InverseRing | tp5_221031_OneShadow | 1.4.1 | 60 |
| tp5_221101_WhiteFlower | tp5_230222_GenerativeColors | 1.5.0 | 51 |
| tp5_230223_AuroraLeaves | tp5_230713_VaporStream | 1.6.0 | 93 |
| tp5_230717_FireFly | tp5_231026_ShadowCircles | 1.7.0 | 47 |
| tp5_231029_FilterExperiments | tp5_240228_Wiper | 1.9.0 | 55 |
| tp5_240304_Waterfall | tp5_240423_BitCarpet | 1.9.1 | 21 |
| tp5_240428_CaleidoBit | tp5_240508_ExBitCarpet | 1.9.2 | 4 |
| tp5_240510_BitGear | tp5_240601_minacoding_ChillWave | 1.9.3 | 12 |
| tp5_240602_minacoding_ColorViscosity | tp5_240806_BlueSplash | 1.9.4 | 35 |
| tp5_240808_ParticleFall | tp5_241111_SeaDragon | 1.10.0 | 30 |
| tp5_241112_SeaFairy | tp5_250422_TriangleDistortion | 1.11.1 | 65 |
| tp5_250428_Quadscope | tp5_250526_6thAnniversary | 1.11.5 | 12 |
| tp5_250528_ArcLines | tp5_260602_minacoding_Music | 1.11.13 | 97 |
| tp5_260603_Image | tp5_260901_ArcTiles | 2.3.2 | 7 |

**全 994 作品のバージョンが確定（未確定 0 件）**。使用バージョンは18種類:
1.1.9 / 1.2.0 / 1.3.1 / 1.4.0 / 1.4.1 / 1.5.0 / 1.6.0 / 1.7.0 /
1.9.0 / 1.9.1 / 1.9.2 / 1.9.3 / 1.9.4 / 1.10.0 / 1.11.1 / 1.11.5 / 1.11.13 / 2.3.2。
各版は `viewer/libs/p5-<version>.min.js` にローカルキャッシュ済み。

注意: p5 2.3.2（`tp5_260603_Image`〜`tp5_260901_ArcTiles` の7件）は 1.x と非互換
（`preload()` 廃止など）。グローバルモードの作品は動くが、7件が実際に正しく描画されるかは
ブラウザ実機での確認が望ましい。

---

## 対処状況

- [x] P1（フォルダ名とjs名の不一致）: 43件を修正済み。
- [x] P2（一時ファイル）: build-manifestで `p5js-temp-*` を除外。
- [x] P3（入れ子構成）: 2件を標準構成へ修正。
- [x] P4（Python作品）: 対象外として削除。
- [x] P5（同梱p5欠落）: 同梱p5を使わないローカル版管理へ移行済み。
- [x] manifest肥大化: p5をバージョン別ファイルへ分離済み。
- [x] p5バージョン: 全994フォルダ分を範囲ルールで確定済み。
- [x] Preview除外: 67件を理由付きで `p5-versions.json` に登録済み。
- [x] 文字数超過確認: 現在のViewerロジックで修正済み。コード内/ caption内のハッシュタグ重複も防止済み。

現在の状態:
- 原本フォルダ: 994件（別管理）
- Preview manifest: **927作品**
- 除外: **67作品**
- グリッド作品: 38作品（1〜4.png + drawなし、5秒ごと再実行）
- 未解決のデータ上の残件: canvas.pngもグリッド画像もない2作品（P6参照）。静止画なしを許容する仕様のため、動作上のブロッカーではない。

---

## 重要な留意点（肥大化）→ 対処済み

- 994作品 × 同梱 p5（約0.5〜1MB/件）を manifest.js に全部埋め込むと、
  `JSON.stringify` の文字列長上限を超えて **生成が失敗**した（実際に Range: Invalid string length）。
- 対策（実装済み）: **p5 をバージョン別ファイルに分離**。
  - `build-manifest.mjs` が p5 を重複排除し `viewer/libs/p5-<version>.min.js` として出力
    （3バージョン = 3ファイル、計約2.2MB）。
  - manifest の entry からは `p5Source` を除去し、`p5Version` だけ保持。
  - `window.PREVIEW_P5 = { "<version>": "libs/p5-<version>.min.js" }` を manifest 先頭に出力。
  - `player.js` は `p5Version` から該当ファイルを fetch＆キャッシュして srcdoc に結合。
- 結果: manifest.js は 0.45MB に収まり、現在の927作品でも問題なく生成・再生できる。

---

## Preview 除外リスト（p5-versions.json の exclude）

プレビュー確認中に、再生に向かない作品を `p5-versions.json` の `exclude` で除外している。
除外した作品は manifest に含まれず Preview で再生されない。理由の記録:

| id | 理由 |
|----|------|
| tp5_210108_CircleSlice | 実行が重い |
| tp5_210216_dc_Kaiga | インタラクション必須（絵画） |
| tp5_210220_MobileChain_PCD2021 | 動作しない |
| tp5_210220_SymmetricCircle | インタラクション作品 |
| tp5_210302_HairBall | 実行が重い |
| tp5_210306_CrystalBall | 見栄えがよくない |
| tp5_210310_SymmetricDance | 動作しない |
| tp5_210311_EraseFlower | 見栄えがよくない |
| tp5_210313_WarmHole | 見栄えがよくない |
| tp5_210323_MirrorTorus | 透過前提 |
| tp5_210324_WhiteTorus | 透過前提 |
| tp5_210417_EnergyShine | 実行が重い |
| tp5_210418_GoldenCircle | 実行が重い |
| tp5_210610_FlowerShade | 実行が重い |
| tp5_210723_Olympic | 白背景前提 |
| tp5_210822_KintaroCandy | 実行が重い |
| tp5_210823_Smiles | 実行が重い |
| tp5_210824_SmileStorm | 実行が重い |
| tp5_210828_BlackLine | 白背景想定 |
| tp5_210829_HexBlack | 白背景想定 |
| tp5_210901_TileMaker | うまく動かない |
| tp5_220201_dc_CircleInspiration | 白背景前提 |
| tp5_220204_dc_HeartSourceCode | 白背景前提 |
| tp5_220209_dc_Fusafusa | 実行が重い |
| tp5_220214_dc_LoveColor | 前衛的 |
| tp5_220214_LoveColor | 前衛的 |
| tp5_220215_dc_OldLogo | 前衛的 |
| tp5_220217_dc_SoundSequencer | p5.sound を使用（非対応） |
| tp5_220329_BlackTatoo | 白背景前提 |
| tp5_220405_ShrinkRainbow | 負荷が高い |
| tp5_220406_ShrinkPlant | 負荷が高い |
| tp5_220407_PseudoHill | 負荷が高い |
| tp5_220411_SquareCity | 負荷が高い |
| tp5_220525_MarbleGrid | 実行が重い |
| tp5_220527_3rdAnniversary | 実行が重い |
| tp5_220604_dc_FaceCandy | 実行が重い |
| tp5_220609_dc_DoremiTone | p5.sound を使用（非対応） |
| tp5_220613_dc_flappy | インタラクティブ作品 |
| tp5_220616_dc_Typing | インタラクティブ作品 |
| tp5_220617_Physics | インタラクティブ（mouseX） |
| tp5_230604_minacoding_Whack_A_Mice | インタラクティブ（mouseIsPressed） |
| tp5_230612_minacoding_MapGen | インタラクティブ（mousePressed） |
| tp5_230618_minacoding_TheCreation_1st_day_light | TheCreation シリーズ（除外） |
| tp5_230619_minacoding_TheCreation_2nd_day_firmament | TheCreation シリーズ（除外） |
| tp5_230619_minacoding_TheCreation_3rd_day_earth | TheCreation シリーズ（除外） |
| tp5_230619_minacoding_TheCreation_4th_day_celestial_body | TheCreation シリーズ（除外） |
| tp5_230622_minacoding_TheCreation_5th_day_fish_and_fowl | TheCreation シリーズ（除外） |
| tp5_230623_minacoding_TheCreation_6th_day_mankind | TheCreation シリーズ（除外） |
| tp5_240614_minacoding_BallControl | インタラクティブ（mouseButton） |
| tp5_220920_BezierMandara | 白背景前提 |
| tp5_230629_FruitLeaves | 実行が重い |
| tp5_231019_LineTunnel | 実行が重い |
| tp5_240408_ShadowBall | 実行が重い |
| tp5_240409_ArcTile | 実行が重い |
| tp5_240411_FarAway | 実行が重い |
| tp5_240518_PunchedCard | 実行が重い |
| tp5_240611_minacoding_KaleidoScope | カメラ入力が必要 |
| tp5_240619_minacoding_YearClock | つまらない |
| tp5_250117_Vines4k | 画面に収まらない |
| tp5_250507_ShootingStar2_0 | 動作しない |
| tp5_250508_SplineDragon | 動作しない |
| tp5_250512_SplineShape | 動作しない |
| tp5_250514_AngelFeather | 動作しない |
| tp5_250515_Lives | 動作しない |
| tp5_250902_Rasen | 動作しない |
| tp5_260320_LayerShape | 実行が重い |
| tp5_260603_Image | 外部リソースを使用（オフライン非対応） |
| tp5_210424_BoneFlower | 実行が重い |
| tp5_210206_BlurParticle | 実行が重い |
