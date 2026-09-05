# v2412照合と検証範囲

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
