# v2412照合と検証範囲

現在の配布方針: mainには最新版v8.3のHTMLだけを置く。以下の旧版HTMLの保持・重複生成に関する記述は当時の履歴であり、現在はビルド・テスト・CIを最新版1ファイルへ統一している。旧版はGit履歴から取得できる。

対象: OpenCFD版 OpenFOAM-v2412 tag。2026-09-05に公式GitLab APIからソースを取得して確認。Foundation版へ読み替えないこと。

| 対象 | 公式ソース | 反映内容 |
|---|---|---|
| AMI形状・zone | [propeller/snappyHexMeshDict](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/tutorials/incompressible/pimpleFoam/RAS/propeller/system/snappyHexMeshDict) | faceType boundary、faceZone / cellZone / cellZoneInside、solid名のmapping |
| AMIペア | [propeller/createPatchDict](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/tutorials/incompressible/pimpleFoam/RAS/propeller/system/createPatchDict) | 主側は元の名前、従側は_slave。neighbourPatchとnoOrdering |
| 回転 | [propeller/dynamicMeshDict](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/tutorials/incompressible/pimpleFoam/RAS/propeller/constant/dynamicMeshDict) | dynamicMotionSolverFvMesh、fvMotionSolvers、solidBody、origin/axis/omega |
| 適合細分化 | [dynamicRefineFvMesh.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/dynamicFvMesh/dynamicRefineFvMesh/dynamicRefineFvMesh.H) | 間隔・alpha.water範囲・最大レベル・セル数・correctFluxes・dumpLevel |
| Boussinesq必須場 | [createFields.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/heatTransfer/buoyantBoussinesqPimpleFoam/createFields.H) | alphatはMUST_READ。laminarでも出力 |
| 圧縮性熱流体 | [hotRoom/fvSchemes](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/tutorials/heatTransfer/buoyantPimpleFoam/hotRoom/system/fvSchemes) | h/e/K/Ekpのdiv設定 |
| isoAdvector | [interIsoFoam/damBreak/fvSolution](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/tutorials/multiphase/interIsoFoam/damBreak/system/fvSolution) | isoAlpha、許容値、clip、nAlphaBounds、pcorr |
| スクリプト | [RunFunctions](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/bin/tools/RunFunctions) | runParallelの-npは実行名より前。未初期化localがあるためset -uは使用せずset -e |
| createPatch場読込 | [createPatch.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/utilities/mesh/manipulation/createPatch/createPatch.C) | patchFieldsを指定しない辞書では既存0/場を読み込まない |

## 実施済み

- 8ソルバーの必須場・解法、圧力次元、VOF物性・相名・初期箱。
- LES/DESのモデル別場と必須場の削除時の出力抑止。
- ASCII / binary STL、binaryヘッダーsolid、無効データ拒否、同名ファイルの追加。
- 面選択、非表示面の出力保持、単位の一度だけの適用、パッチ名変更、取り消し、内部ノズルの操作。
- AMI/MRF/剛体回転/適合細分化の設定、回転軸・円筒の入力検査、壁速度の追従。
- JSON作業復元、ZIPの独立した読込とCRC検証。

## 未実施

- Chrome/EdgeのWebGL描画・ピッキングの目視確認。本作業環境ではブラウザのURL制限により実施できなかった。
- v2412でのfoamDictionary / blockMesh / snappyHexMesh / createPatch / topoSet / ソルバー実行。
- 実形状でのメッシュ品質、流体領域、パッチ面数、回転zoneの所属。
- AMIを時間進行させた面積重み・品質・保存則、AMRの細分化と粗大化。

生成器の回帰検証は、ソルバー実行による検証や物理的妥当性確認を代替しない。

## 手元での受入手順

1. HTMLを開き、内部ノズルの例を表示。外側tankを隠して、ノズル上面へwaterJetを割り当てる。
2. mmの実STLで元寸法・選択面積・出力STL・背景領域のm寸法が一致することを確認。
3. pimpleFoam / interFoamを切り替え、pとp_rgh、alpha.waterが切り替わることを確認。
4. 実形状に対しAMI円筒を設定。回転部を完全に含むよう半径・長さ・軸を設定。
5. ZIPを新規ケースへ展開しAllrun。ログとpolyMesh/boundaryを確認し、AMI両面が0面でないこととrotorZoneの所属を確認。
6. 回転後のメッシュとAMI重みを確認し、時間刻みを半分にして主要評価量を比較する。


## v8: Force UI・加速度CSV・初期水STL

- 2026-09-05: `npm run build` 成功、Node/jsdom回帰テスト **66件成功**。
- Force / forceCoeffsの4通りの有効化で、共通値と係数専用値・複数行の方向入力を確認。レスポンシブなfieldsetとlabel/descriptionの関連付けを検査。
- CSVの4列、単位・符号・数値精度、時間順序、解析時間と最終ステップの余裕、不正置換、非対応の組み合わせ、グラフ生成、保存/復元を検査。
- 初期水STLの閉鎖性・向き・連結性、凹形状、単位の一度だけの適用、メッシュ用STLとの同名分離、snappy/features/パッチへの非混入を検査。実際のダウンロードZIPをPython zipfileで開き、パス・内容・CRCも確認。
- v2作業データへの追加入力保存、v1作業データの移行、不正データの復元前検査を確認。

v2412の辞書・動作根拠は [加速度入力](acceleration-evidence.md) と [初期水領域](water-region-evidence.md) を参照。
OpenFOAMの実行と実ブラウザでの描画目視は引き続き未実施。自動テストの成功を、実メッシュ生成・水量や圧力の物理検証の成功とは扱わない。


## v8.1: 読み込み欄の見つけやすさ

- 調査時点でmainはv6、PR側はv8。v8の両ファイル選択欄も初期状態ではhiddenだったことを確認。
- 両ファイル選択欄を常時表示し、上部のナビゲーションから直接移動できるよう変更。ファイル選択でCSV入力の有効化 / STL指定への切り替えを行う。
- 取り違えを防ぐ版番号付き配布ファイル OpenFOAM_v2412_case_builder_v8_1.html を追加。従来名のHTMLと同じ内容をビルドする。
- npm run build成功、回帰テスト69件成功。初期DOMでの表示、ファイル選択のchangeイベントからの有効化・出力、メッシュ用STLとの分離を確認。実ブラウザでの目視は未実施。


## v8.2: 軸別の数式波形

- v8.1はユーザー承認によりPR #1をmainへマージ済み（0c947514e172f40c8bcda129539ed154a112e79b）。v8.1の版番号付きHTMLは変更しない。
- 正弦波・余弦波・一定値・任意の許可された数式をX/Y/Zへ個別設定。周期/周波数切り替えは逆数換算、位相入力は度からradへ変換。CSVと波形の値・単位を分離。
- 純粋な生成処理を独立した解析式と照合。非ゼロ開始時刻、位相差、異なる周期、減衰、式の優先順位、非整数の最終標本間隔、単位・CSV再読み込みを検査。
- 数式は算術構文木で評価し、JavaScriptのeval/Functionは使わない。未定義変数・不正構文・非有限な中間値/評価値・点数上限・正弦波の標本間隔を検査。
- v3作業保存/復元、旧v2移行、CSV切り替え、編集中の不正な式による古い波形の出力抑止を確認。
- npm run build成功、回帰テスト84件成功。OpenFOAM実行・実ブラウザでの目視は未実施。連続式は標本化して従来と同じ加速度テーブルに変換する。

## v8.3: locationInMesh の1点表示

- npm run build成功、Node/jsdomとビューアーの回帰テスト92件成功。
- v8.2はPR #2でmainへマージ済み（9461c940bb307da05d1934edb9b3180e4a97c7cc）。配布用v8.1 / v8.2 HTMLはそのまま残し、v8.3と従来名のHTMLをビルドする。
- 既存のlocationInMesh入力を3D画面直下へ移動。辞書出力と同じ1つの値を参照し、表示用のみSTLの単位へ逆換算する。座標変更・自動設定・プロジェクト復元で古い点を残さない。
- 点の輪郭をSTL越しにも表示し、中央は表示中のSTLとの深度テストを使う。輪郭だけの点は遮蔽を示すもので、内外判定ではない。AMI/MRFの補助線は点を遮る不透明な面として扱わない。
- Node/jsdomで座標と辞書の同期、m / mm / cm / inch、blockMeshの縮尺との分離、不正入力、面からの設定、背景領域からの設定、非表示操作、旧v1/v2を含む復元を検査。
- ビューアーの投影座標、X/Y/Zの視点、パン、縦長画面での全体表示、Home、画面外の点を検査。WebGL APIの記録用スタブで、1点の描画座標の置換、深度状態、ピッキングへの非混入を検査。スタブはシェーダーをコンパイルせず、描画画素の検証ではない。
- 実ブラウザのWebGL描画目視・OpenFOAMの実行は引き続き未実施。

手元での受入確認: デモ形状で `(0.5 0 0)` を入力し、X/Y/Zの各視点で位置を確認する。外側tankを隠すと点の中央が見えること、`(3 0 0)` に編集すると古い点が消えること、全体表示で新しい点が収まることを確認する。mmの実STLでm座標を入力し、出力したSTL・snappyHexMeshDictの座標と照合する。
