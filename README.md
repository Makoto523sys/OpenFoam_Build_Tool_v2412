# OpenFOAM v2412 Case Builder v8

STLを見ながらパッチと境界条件を設定する、オフラインのケース生成ツールです。対象は **OpenCFD版 OpenFOAM v2412**。既存のファイル名を維持しています。

**[OpenFOAM_v2412_case_builder_v3.html](OpenFOAM_v2412_case_builder_v3.html)** をダウンロードし、Chrome / Edge / Firefoxで開いてください。npm、サーバー、外部CDNは実行時に不要です。STLや作業データを外部へ送信しません。

## 基本操作

1. 上部のファイル選択からASCII / binary STLを読み込む。複数ファイルを追加できます。
2. `STL座標 → m`で元の単位を指定。mmなら×0.001。表示・保存中は元の座標を保持し、ケースZIPのSTL出力時に一度だけmへ変換します。
3. クリックで三角形・連続面・接続部品・元のsolid・パッチを選択。Ctrl / Shiftで追加選択。ドラッグで回転、右ドラッグで移動、ホイールで拡大します。
4. `選択面を非表示`、部品ごとの非表示、単独表示で内部へアクセス。**非表示の面もケース出力には残ります。** `すべて再表示`と`面操作を戻す`で戻せます。
5. パッチ名、用途、速度・流量・温度・相分率を入力して割り当て。STL solid名、snappyHexMeshのregion、全ての`0/`の境界名へ反映します。
6. `STLから背景領域を設定`、流れ方向、`locationInMesh`を設定。背景領域は余白20%の外接箱です。初期の保持点は外部流れ用の箱の隅です。**内部流れでは容器内の流体側へ変更してください。** 選択面から法線方向にオフセットした点も設定できます。
7. ソルバー・物性・乱流・数値条件を設定し、エラーがなければケースZIPを保存します。
8. `作業を保存`で、形状・パッチ・非表示状態・初期水STL・加速度CSV・設定をJSONに保存できます。ブラウザを閉じる前に保存してください。自動保存はありません。

`内部ノズルの例を表示`で、外側の箱を隠して内部ノズルの上面を入口に指定する操作を試せます。これは操作説明用形状です。物理検証済みの流動例ではありません。

## Force / Force coefficientsの設定

controlDictのFunction Objectsを「出力量」「共通設定」「係数の基準値」に整理しました。forces / forceCoeffsは個別に有効化できます。patches、rhoInf、CofRは共通、magUInf、lRef、Aref、方向ベクトルは係数用です。画面幅に応じて入力欄が折り返され、方向入力は全幅で編集できます。

## スロッシングの加速度CSV

1. `interFoam` または `interIsoFoam` と `固定メッシュ` を選びます。
2. 「スロッシング：容器の入力加速度」を有効化し、加速度単位を選んでCSVを読み込みます。`m/s²`、`Gal`、標準重力単位の`g`に対応します。時間は秒です。
3. CSVはカンマ区切りの `time,ax,ay,az` の4列。見出しは省略できます。時刻は0以上、厳密な昇順、重複なし、2点以上が必要です。
4. 3成分のグラフ・入力点数・時刻範囲・最大絶対値を確認します。「CSV範囲に解析時間を合わせる」で、CSV終端に余裕を残して開始・終了時刻を設定できます。可変刻みでmaxDeltaT未設定の場合は現在のdeltaTを上限にします。
5. 通常の重力は物性欄の`g`に設定します。CSVには重力を含めず、**容器の並進加速度をそのままの符号で**入力します。

```csv
time,ax,ay,az
0,0,0,0
0.25,1,0,0
0.5,0,0,0
0.75,-1,0,0
1,0,0,0
```

容器に固定された、回転しない座標系で解きます。v2412の`tabulatedAccelerationSource`が全流体領域に `g_effective = g - a_container` を適用し、`gh`・`ghf`も更新します。メッシュの並進変位を作る機能ではありません。回転・MRF・界面適合細分化との併用はこの入力方式では未対応です。速度境界も容器に対する速度で指定します。

CSV原本は`constant/acceleration/input.csv`、SIへ変換したテーブルは`constant/acceleration/translation.dat`、ソース設定は`constant/fvOptions`へ出力します。`$FOAM_CASE`を使うため、別のディレクトリからの`-case`起動にも対応します。

OpenFOAMの補間は3点以上でスプライン、2点で線形です。グラフは入力点を結ぶ線であり、実計算の点間の補間値は入力極値を超えることがあります。CSV終端を超えるとOpenFOAMが停止するため、終了時刻から最大時間刻み1回分（`adjustableRunTime`では2回分）の余裕を検査します。自動の外挿・ゼロ埋めは行いません。開始方法は`startTime`、停止条件は`endTime`にしてください。

荷重評価はソルバーが更新した`p`を使い、`p_rgh`や元の重力だけから再構成した圧力と混同しないでください。入力の帯域とスロッシング応答の両方を時間刻みで解像し、符号・自由表面・水量保存を実計算で確認します。実装根拠と検証手順は[加速度入力の根拠](docs/acceleration-evidence.md)にあります。

## 初期水領域の専用STL

「VOFの初期水領域」で、従来のボックス指定と、専用STL指定を切り替えられます。

- ボックスは対角の最小・最大座標をmで指定します。
- STLは**水が占める体積を囲う閉曲面**を、メッシュと同じ原点・座標軸で用意します。専用の読み込み欄・単位設定・3Dビューがあり、メッシュ用STLとは別々に保持します。
- 現在は1つにつながった、外向きの閉曲面1ファイルに対応します。凹形状は使用できます。開いた面、向きの不整合、内向き面、非多様体、離れた複数殻・入れ子殻は読み込み時に理由を表示します。CADの自動修復は行いません。
- 初期水STLは`constant/triSurface/initialWater/water.stl`へ出力し、**snappyHexMesh・surfaceFeatureExtract・境界パッチには追加しません**。メッシュ用STLと同名の入力ファイルでも混ざりません。
- `setFieldsDict`の`searchableSurfaceToCell`で、セル中心が閉曲面内にあるセルに`alpha.water=1`、それ以外に0を割り当てます。界面を横切るセルの水体積率を幾何学的に積分する方式ではありません。

専用STLの単位はメッシュ側と独立してmへ一度だけ変換します。ボックスへ戻すとSTLは出力せず、作業データ内には保持します。旧v7の作業ファイルも読み込めます。

自己交差はツール内では検査できません。`surfaceCheck -checkSelfIntersection constant/triSurface/initialWater/water.stl`の**ログ内容**を確認し、setFields後の`alpha.water`と実メッシュとの位置関係をParaViewで確認してください。surfaceCheckは自己交差を報告しても終了コード0を返す場合があります。仕様根拠は[初期水領域の根拠](docs/water-region-evidence.md)にあります。

## 動的メッシュ・回転

| 方式 | 対応ソルバー | 生成する設定 |
|---|---|---|
| 固定 | 下記の8ソルバー | 通常のケース |
| MRF | simpleFoam / pimpleFoam | 円筒のtopoSet、cellZone、MRFProperties |
| AMI回転 | pimpleFoam / interFoam / interIsoFoam | 円筒STL、snappy faceZone/cellZone、境界分離、createPatch、dynamicMeshDict |
| 全領域剛体回転 | pimpleFoam / interFoam / interIsoFoam | solidBody motion、dynamicMeshDict |
| VOF界面適合細分化 | interFoam | dynamicRefineFvMesh、界面範囲・間隔・レベル・セル数上限 |

回転は中心[m]、軸、rpmで指定し、omega[rad/s]へ変換します。AMI/MRFの円筒はビューに青緑の線で表示します。回転する壁の速度は`movingWallVelocity`へ自動で切り替えます。MRFはメッシュを動かしません。

AMIの円筒は回転部品を完全に囲み、背景境界や静止物体と交差させないでください。部品の頂点が円筒内外にまたがる場合は出力を止めます。この検査は完全な三角形交差判定ではありません。回転部品の形状、cellZoneの所属、AMI両面の面数・補間重みはOpenFOAMで確認してください。

適合細分化はVOF界面の解適合です。メッシュ運動とは別の方式です。非六面体などの保護セルは細分化できない場合があり、最初の格子品質や壁面解像度の設計を代替しません。

## ソルバーと出力の修正

- pimpleFoam、simpleFoam、icoFoam、buoyantBoussinesqPimpleFoam、buoyantPimpleFoam、rhoPimpleFoam、interFoam、interIsoFoamを対象に、必須場と圧力次元を検査します。
- ソルバーから現象・定常/非定常・圧力・熱の設定を決め、矛盾する組み合わせを防止。icoFoamはPISO、simpleFoamはSIMPLE、その他はPIMPLEを出力します。
- Boussinesqでlaminarでも必要なalphat、圧縮性浮力で必要なp、熱流体のh/e/K/Ekp輸送設定、DESのnuTildaやk/omega、isoAdvector設定を補いました。
- VOFの相識別名はwater / airに統一。相1の編集済み物性とalpha.water・setFieldsが一致します。材料を変更してもこの識別名は変わりません。
- 正しいmovingWallVelocityを出力し、圧力入口で速度も固定していた不整合を修正しました。
- 背景面・STLパッチの境界表への同期、パッチ名変更の追従、単位換算、特徴線角度、直列/並列のAllrunを修正しました。
- 必須場の欠落、重複、非数値、ゼロ回転軸、領域外の保持点、未対応のソルバー/運動の組み合わせは、理由を表示して出力を止めます。

CHT、多領域熱連成、任意のcyclicペア、overset、six-DoF、LRR/SSG/v2fなどの追加場を必要とするモデルは未対応です。従来の不完全なCHT雛形は選択を無効化しています。

## 実行と検証

```sh
source /path/to/OpenFOAM-v2412/etc/bashrc
unzip of2412_case.zip
cd of2412_case
chmod +x Allrun Allclean
./Allrun
```

Allrunはメッシュ生成、必要なAMI/MRF処理、checkMesh、VOFのsetFields、ソルバーを順に実行します。並列数1なら直列、それ以外ならdecomposeParとrunParallelを使用します。blockMesh無効時は既存のconstant/polyMeshが必要です。失敗時はそこで停止します。標準RunFunctionsは既存ログを持つ処理をスキップするため、条件変更後は新しいケースへ出力するか、対象ログと生成物を適切に整理してください。

**このツールはOpenFOAMを実行しません。** 開放辺・非多様体辺の件数は表示しますが、自己交差・法線の整合・流体領域の連結性・AMI品質を保証しません。

内部ノズルの入口は、保持する流体セルと接する境界面でなければなりません。接続した流体中に浮く単独のSTL面を一側の入口にする処理はありません。閉じたノズル固体の端面を選択してください。CAD修復・自動キャップも対象外です。

生成後はsurfaceCheck、checkMesh、パッチ名と面数、収束・保存則、格子/時間刻み依存性を確認してください。AMIでは回転後にも品質と補間重みを確認します。

## 開発・検証状況

```sh
npm ci
npm run build
npm test
```

- 編集対象: src/template.html（既存GUI・辞書）、src/workbench.html / workbench.js（面操作・検査・運動）、geometry.js（STL）、viewer.js（WebGL）、acceleration.js / water-region.js（専用入力の検証・変換）、inputs-ui.js（専用UI・出力・作業保存の統合）。
- npm run buildで配布用HTMLへインライン化。生成済みHTMLもコミットしてください。
- Node/jsdomでDOM操作、ソルバー切り替え、STL入出力、面操作、パッチ同期、動的設定、作業復元を検証。ZIPはPython標準zipfileでもCRCと内容を確認します。
- OpenFOAM v2412の実行環境がないため、メッシュ生成・ソルバー計算は未実施です。実ブラウザでのWebGL描画・ピッキングの目視確認も実行環境の閲覧制限により未実施です。
- 1 STLにつき50万三角形 / 80 MB、メッシュ用は全体で75万三角形、初期水用は別枠で50万三角形が上限。CSVは20 MBまで。大規模形状は事前に軽量化してください。

v2412公式ソースとの照合内容は [docs/verification.md](docs/verification.md) に記録しています。
