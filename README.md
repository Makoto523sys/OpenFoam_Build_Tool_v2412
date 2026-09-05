# OpenFOAM v2412 Case Builder v7

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
8. `作業を保存`で、形状・パッチ・非表示状態・設定をJSONに保存できます。ブラウザを閉じる前に保存してください。自動保存はありません。

`内部ノズルの例を表示`で、外側の箱を隠して内部ノズルの上面を入口に指定する操作を試せます。これは操作説明用形状です。物理検証済みの流動例ではありません。

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

- 編集対象: src/template.html（既存GUI・辞書）、src/workbench.html / workbench.js（面操作・検査・運動）、geometry.js（STL）、viewer.js（WebGL）。
- npm run buildで配布用HTMLへインライン化。生成済みHTMLもコミットしてください。
- Node/jsdomでDOM操作、ソルバー切り替え、STL入出力、面操作、パッチ同期、動的設定、作業復元を検証。ZIPはPython標準zipfileでもCRCと内容を確認します。
- OpenFOAM v2412の実行環境がないため、メッシュ生成・ソルバー計算は未実施です。実ブラウザでのWebGL描画・ピッキングの目視確認も実行環境の閲覧制限により未実施です。
- 1 STLにつき50万三角形 / 80 MB、全体で75万三角形が上限。大規模形状は事前に軽量化してください。

v2412公式ソースとの照合内容は [docs/verification.md](docs/verification.md) に記録しています。
