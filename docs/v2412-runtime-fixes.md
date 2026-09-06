# v8.4: v2412実行時の不具合修正と確認範囲

対象はOpenCFD OpenFOAM v2412。ユーザーの実行報告はpatch=260127、pimpleFoam・RAS kOmegaSST・静止メッシュである。
この作業環境にはOpenFOAM本体と元ケース/STLがない。以下の生成・検査処理は修正したが、**対象ケースの通常ソルバー実行、凹セルの改善、長時間安定性は未検証**である。

## 修正内容

| 項目 | 生成・検査の変更 | 残る確認 |
|---|---|---|
| PIMPLE residualControl | pまたはp_rgh、Uにtolerance/relTol辞書を出力 | v2412での通常起動 |
| SIMPLE / PISO | SIMPLEはスカラー基準を維持、PISOは外部反復用residualControlを出力しない | 小ケースで別々に通常実行 |
| 実出口の圧力 | 背景/STLの出所を表示。流入・圧力条件・初期Uの組合せを事前/実メッシュで確認 | 元ケースの実出口へ意図した用途を指定 |
| 逆流の乱流量 | pressureOutletでU=pressureInletOutletVelocity、k/omega等はinletOutletと入口値 | 逆流の発生と境界値の妥当性 |
| 流量監視 | 複数候補選択、名前変更の追従、個別流量と符号付き和。自動選択は実パッチへ絞る | 監視データの実出力 |
| 残差監視 | solverInfoへ変更。解く場から自動選択し手動指定も検査 | 実出力とソルバー残差履歴 |
| 対称条件 | symmetry / symmetryPlane / emptyを明示。STLの平面性・法線、背景の厚み1セルを検査 | symmery.stlの解析意図。最終メッシュでの要件 |
| checkMesh | 毎回新規実行。終了コードとログのMesh OK./End/Failedを確認。メッシュのSHA-256を前後比較 | 元メッシュの凹セル位置と原因 |
| 層厚 | 相対/絶対m、膨張率、最小総厚さを入力。層数から第一層・総厚さを表示し整合検査 | 実際の層の残存・品質・yPlus |
| ログ指定 | 未登録のInfoSwitches levelと入力欄を削除 | 必要な詳細ログは実在スイッチで個別指定 |
| 単位・流量 | STL全体寸法[m]、入口面積[m²]、速度[m/s]、入力流量目安[m³/s]を表示 | 元モデルの30 × 6.5 × 1 m、約50 m³/sが意図通りか |

## 出口条件と背景パッチ

`outletZeroGradient`は廃止していない。非圧縮pではUとpがzeroGradientとなる用途であり、別の圧力条件、流量収支、初期化が適切なケースは存在する。

ただし、非ゼロの指定流入・初期内部U=0・実パッチ上に圧力条件がない組合せでは、流出流束を初期に調整できない場合がある。pRefCell/pRefValueは圧力の基準値を定めるもので、流出を作る機構ではない。

HTMLでは最終パッチの残存を確定できない。STL入口/ゼロ勾配出口が背景側の圧力条件に依存する場合は具体的な対象名と注意を表示し、背景圧力が実際に消えた場合はAllrunの実パッチ検査で停止する。これにより、実際には残る背景出口を使う外部流れを一律に禁止しない。

今回の報告に対する設定操作は、STL由来の`outlet_outlet`を選び、意図が圧力出口なら用途を`pressureOutlet`、非圧縮p=0にする。`inlet_inlet`の流入速度はユーザーが指定する。名前から用途や速度・スケールを上書きしない。背景用`outlet`等の初期場は一律には削除しない。

初期内部速度は第5欄で明示して設定できる。非ゼロ初期速度や釣り合った指定流量を使う純Neumann圧力系は、収支・圧力基準を別途確認する。検査は全ての流体問題の可解性を証明するものではない。

## 監視の出力

- `controlDict`の残差監視は`solverInfo1`。kOmegaSSTのpimpleFoamなら`p U k omega`。p_rgh系、層流、k-epsilon系でリストを切り替える。圧縮性ではこのツールのsensibleEnthalpyに対応するhを含める。代数的なnutや、解かない場を残差対象にはしない。
- 流量監視は`system/flowMonitors`をcontrolDictのfunctions内へincludeする。ZIPには両方を含むので、controlDict単体ではなくケース一式を使用する。
- 自動選択は、登録済みの入口・出口用途が対象。Allrunは`constant/polyMesh/boundary`等の実メッシュを読み、残存し面数が1以上の対象へ絞る。消えた候補は検査記録に明示する。
- 手動選択の不存在・0面パッチはエラーにし、対象名と実パッチ候補を示す。自動修正で別のパッチへ付け替えない。
- `patchFlux_<patch名>`を個別出力し、sumかつ2パッチ以上なら`flowBalance`も出す。個別流量の符号は外向き正、流入負。pimpleFoamのphiはm³/s、圧縮性単相のphiやVOFのrhoPhiはkg/s。領域内の蓄積がある系では入口出口の和だけで収支を判定しない。
- パッチ表での名前変更、パッチ全体のSTL再割当、背景面の名前変更で参照を追従させる。パッチの一部だけを分割する操作では、元パッチが残るので監視先を勝手に付け替えない。

## Allrunの検査順序

1. OpenCFD v2412環境とPython 3を確認。blockMesh、snappyHexMesh等を新規実行する。既存ログによるスキップは使わない。
2. `scripts/validate_case.py`が解析開始時刻を選び、その時刻のメッシュファイルを特定してハッシュを記録する。
3. `checkMesh -time <開始時刻> -allTopology -allGeometry -writeSets vtk -noFunctionObjects`を実行し、`log.checkMesh`を毎回上書きする。
4. 終了コード0に加え、`Mesh OK.`と正常な`End`を要求し、`Failed N mesh checks.`や異常終了を拒否する。検査前後にメッシュが変わった場合も停止する。
5. 面数がある実パッチと、各初期場のboundaryField・メッシュ型・登録用途・圧力条件・監視先を照合する。初期場はfoamDictionaryで読み、ネイティブのinclude展開とファイル形式を使う。
6. 自動流量監視のincludeファイルを実パッチに合わせ、全検査合格後だけsetFields、decomposePar、ソルバーへ進む。

検査は`case-check-report.json`へ記録する。検査開始時に旧成功記録を無効にする。`sh Allrun`と`./Allrun`のどちらでもケースのディレクトリへ移動できる。
再実行ではメッシュ処理も再実行する。計算再開で既存メッシュを使う場合は、HTMLのメッシュ出力を無効にし、開始時刻・初期場を整合させる。

## 凹セルと層の扱い

報告された最大非直交角44.165986°、最大skewness 0.50482577は、今回のcheckMeshでは合格している。482凹面・5092凹セルの位置と形状が未提供のため、スナップや細分化遷移が原因だと断定していない。

`-writeSets vtk`の出力とログを使い、concaveCells/concaveFacesが、鋭角・細分化遷移・スナップ・部品接合のどこへ集中するか確認する。HTMLにnCellsBetweenLevels、snap tolerance、nSolveIterを設けたが、原因を見ずに変更はしない。既存のmaxNonOrtho=75へのrelaxed指定は削除し、品質基準を緩めて合格扱いにする処理は追加していない。

層の指定は最外層厚さt、膨張率r、層数Nとし、第一層は`t / r^(N-1)`、総厚さは`Σ(t/r^i), i=0..N-1`。minThicknessは最小**総**厚さと比較する。
relativeSizes=trueでは比であり、0.001を1 mmとして扱わない。層追加が無効なら、この組合せだけで起動を禁止しない。層の有無だけで壁面解像度を判定せず、yPlusと求める量のメッシュ依存性を確認する。

## PIMPLEの残差基準の意味

PIMPLEのresidualControlは、各時間ステップ内の外部反復を収束判定で短縮するための設定。`nOuterCorrectors=1`では短縮できる外部反復がない。辞書の形式は、それでも正しくなければならない。時間全体の定常到達や長時間の安定性を判定して計算を終了する基準とは異なる。
SIMPLEのresidualControlは定常反復の終了条件。圧力方程式等の線形ソルバーのtolerance/relTolとも区別する。

## v2412での受入実行

実v2412用の小ケース生成・実行スクリプトを追加した。元ケースの代用となる物理検証ではなく、辞書読込みと起動・監視の確認用である。STL小ケースの対称条件はテストで明示した設定であり、ユーザーのsymmery.stlの意図を推定したものではない。

```sh
# リポジトリで依存を導入し、配布HTMLをビルドする
npm ci
npm run build
node scripts/create-native-smoke.cjs /tmp/v2412-builder-smoke

# OpenCFD v2412のetc/bashrcをsourceしたシェルで実行する
python3 scripts/run-native-smoke.py /tmp/v2412-builder-smoke
```

PIMPLE外部反復1/3、SIMPLE、PISO、p_rghを使うVOF、STLチャネルの6ケースを作る。非定常ケースはadjustTimeStep=noで0.005 sまでの小テストとし、endTimeを短くしただけで最初の可変時間刻みを制限できるとは扱わない。
実行スクリプトは通常のソルバーを起動し、solverInfo・入口/出口の個別流量・符号付き和のファイルと時刻を確認する。`native-results.json`は実際に通過したケースだけを記録する。dry-runの成否を通常起動の判定には使わない。

この環境で確認したのは6ケースの**生成**まで。元ケースの実メッシュ検査と通常ソルバー実行には、元ケースZIP（constant/polyMesh、0、system、constant/triSurface、可能なら作業JSON）が必要である。1ステップ成功も、本解析の妥当性確認には代えない。

## 根拠

- PIMPLE形式とadjustPhi、監視先のエラー: ユーザー提供のv2412 patch=260127通常実行ログ。原ケースは未受領。
- [v2412 solverInfo API](https://api.openfoam.com/2412/classFoam_1_1functionObjects_1_1solverInfo.html)、[v2412 post-processing](https://www.openfoam.com/news/main-news/openfoam-v2412/post-processing): solverInfoの登録・残差監視。
- [surfaceFieldValue](https://doc.openfoam.com/2306/tools/post-processing/function-objects/field/surfaceFieldValue/): patchの流束集計。複数パッチのnames指定のv2412実行は受入スクリプトで確認する。
- [symmetryPlane v2412 source](https://api.openfoam.com/2412/symmetryPlanePolyPatch_8C_source.html): 共通法線と平面性の制約。
- [layerParameters source](https://api.openfoam.com/2312/layerParameters_8H_source.html): minThicknessは最小総厚さ。
- [checkMesh writeSets](https://www.openfoam.com/news/main-news/openfoam-v3.0/meshing): 不良セットの可視化出力。v2412での合否の終了コード挙動はユーザーの実行報告に基づく。
