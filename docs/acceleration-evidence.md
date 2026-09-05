# CSV入力加速度: v2412実装根拠

対象は **OpenCFD OpenFOAM-v2412**。Foundation版や OpenFOAM 2.4.x の仕様を流用していない。以下のソースを公式GitLabの `OpenFOAM-v2412` タグで確認した。ソースから確認できる仕様と、未実施の実行検証を区別する。

## 物理モデル

固定した容器座標系の全流体領域に、容器の並進加速度 `a_container(t)` を与える。容器の軸の向きは時間変化せず、容器に対する流速を解く。運動方程式の加速度は `g_effective = g_base - a_container(t)` となる。

- CSVは `time, ax, ay, az` の4列。時間は秒。加速度の入力単位は画面で選び、出力前にSIへ一度だけ変換する。`1 Gal = 0.01 m/s²`、`1 g = 9.80665 m/s²`。
- CSVに入れるのは**容器の並進加速度**。慣性力の向きに符号を反転させない。重力は別の `constant/g` に設定し、加速度CSVへ重複して加えない。重力を含むセンサーの生の比力データは、そのまま容器加速度として使えない。
- XYZはモデルと同じ右手座標系。単位換算以外の回転、ドリフト補正、フィルター、積分は行わない。地震加速度から変位を自動生成してメッシュを動かす機能ではない。
- 初回の対応範囲は静止メッシュの `interFoam` / `interIsoFoam`。回転座標系、MRF、移動メッシュとの同時使用はこの機能の対象外。壁面速度は容器に対する速度として指定する。

## ネイティブ辞書とテーブル

`constant/fvOptions` の本文:

```foam
containerAcceleration
{
    type tabulatedAccelerationSource;
    active yes;
    timeDataFileName "$FOAM_CASE/constant/acceleration/translation.dat";
    U U;
}
```

`constant/acceleration/translation.dat` の例（元CSVは `constant/acceleration/input.csv` に保持）:

```foam
(
    (0   ((0 0 0) (0 0 0) (0 0 0)))
    (0.5 ((2 0 0) (0 0 0) (0 0 0)))
    (1   ((0 0 0) (0 0 0) (0 0 0)))
)
```

各行は `時刻 (並進加速度ベクトル 角速度ベクトル 角加速度ベクトル)`。後ろの2ベクトルを常にゼロにする。`timeDataFileName` はv2412で直接記述できる。`selectionMode` や `cellSet` は付けない。このモデルは `fv::cellSetOption` ではなく `fv::option` を継承し、全領域に作用する。

`$FOAM_CASE` はv2412が設定するグローバルケースの絶対パスで、ネイティブの `fileName.expand()` が展開する。ケース外のディレクトリから `-case` で起動しても、通常のローカルMPI並列でも、ケース直下の同じテーブルを読む。`processorN` へのCSV複製は不要。生成したAllrunも最初にケースディレクトリへ移動する。

v2412のネイティブ補間は**3点以上ならCatmull–Romスプライン、2点なら線形**。不等間隔の時刻を受け付けるが、入力値の極値を越える補間が起こり得る。表示上の直線で結んだCSV標本を、計算中の補間曲線と誤認しないこと。入力の標本間隔と解析の時間刻みは別物であり、短いパルスを解像できる時間刻みが必要である。

テーブルの最初より前、最後より後の時刻で評価すると、OpenFOAMはエラーで停止する。本ツールでも時刻の重複・逆順・負値、非有限数、列数不足、2点未満を拒否し、解析の開始・終了時刻がCSVの範囲内か確認する。端点の延長、ゼロ埋め、外挿を勝手に行わない。

**CSV末尾に実データの余裕を要求する。** v2412の `Time::run()` は終了時刻の半ステップ手前まで時間ループを続けるため、最後の評価時刻が `endTime` を越え得る。例えば固定 `deltaT=0.3`、`endTime=1.1` は1.2秒へ進む。`endTime=CSV最終時刻` の確認だけでは不十分である。

- 基本の余裕 `M = max(deltaT, maxDeltaT)`。固定時間刻みなら `M = deltaT`。
- 自動時間刻みでは、有限かつ正の `maxDeltaT` の指定を必須にする。
- `writeControl=adjustableRunTime` の場合は、保存時刻への整合処理が時間刻みを最大2倍にし得るため `M` をさらに2倍にする。
- `CSV最終時刻 ≥ endTime + M` を要求する。小さい二進丸め誤差のみ比較時に許容し、CSV自体の時刻は変更しない。

これは保守的な一ステップ分の余裕であり、外挿ではない。余裕不足は必要な秒数と修正可能な終了時刻を示して出力を止める。解析時間、時間刻み、保存時刻制御、再開条件を手動変更した場合も再確認する。解析中に独自のfunctionObjectで時間刻みを上書きしたり、`runTimeModifiable`で上限を変更した場合は、この生成時の確認の対象外となる。

## ソースで確認した事実

| 根拠 | v2412で確認した内容 |
|---|---|
| [tabulatedAccelerationSource.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/sources/derived/tabulatedAccelerationSource/tabulatedAccelerationSource.H) | `timeDataFileName`、省略時U、`fv::option`継承。 |
| [fvOption.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/finiteVolume/cfdTools/general/fvOptions/fvOption.C) | `optionalSubDict(modelType + "Coeffs")` により、係数はモデル本文へ直接指定可能。 |
| [tabulatedAccelerationSource.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/sources/derived/tabulatedAccelerationSource/tabulatedAccelerationSource.C) | 初期の重力を `g0_` に保存。密度あり／なしの運動方程式に対応。 |
| [tabulatedAccelerationSourceTemplates.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/sources/derived/tabulatedAccelerationSource/tabulatedAccelerationSourceTemplates.C) | 重力があれば `g0_ - a` に更新し、`hRef` を使って `gh` と `ghf` を更新。重力場がなければ運動量に負の並進加速度源を追加。角速度・角加速度の項もここで加算。 |
| [tabulated6DoFAcceleration.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/sources/derived/tabulatedAccelerationSource/tabulated6DoFAcceleration/tabulated6DoFAcceleration.H) / [tabulated6DoFAcceleration.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/sources/derived/tabulatedAccelerationSource/tabulated6DoFAcceleration/tabulated6DoFAcceleration.C) | `Vector<vector>` の3ベクトルを時刻との組で読み込み、`interpolateSplineXY` で補間。時刻範囲外はFatalError。 |
| [interpolateSplineXY.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/OpenFOAM/interpolations/interpolateSplineXY/interpolateSplineXY.H) / [interpolateSplineXY.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/OpenFOAM/interpolations/interpolateSplineXY/interpolateSplineXY.C) | Catmull–Rom補間。2点の場合は線形補間する分岐。 |
| [interFoam/createFields.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interFoam/createFields.H) / [UEqn.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interFoam/UEqn.H) | `g`、`hRef`、`gh` を作った後にfvOptionsを生成。`fvOptions(rho,U)` の評価後に重力項で運動量予測。 |
| [interIsoFoam/createFields.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interIsoFoam/createFields.H) / [UEqn.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interIsoFoam/UEqn.H) | interFoamと同じ必要場とfvOptions呼び出し順。 |
| [interFoam/pEqn.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interFoam/pEqn.H) | 圧力補正に `ghf` を使い、`p = p_rgh + rho*gh` で圧力を更新する。 |
| [interIsoFoam/Make/options](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/interIsoFoam/Make/options) / [src/fvOptions/Make/files](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/fvOptions/Make/files) | ソルバーのfvOptionsリンクと、加速度モデルがlibfvOptionsに含まれること。 |
| [argList.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/OpenFOAM/global/argList/argList.C) / [RunFunctions](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/bin/tools/RunFunctions) | `setCasePaths()` が `FOAM_CASE` を絶対パスで設定。`runParallel()` は同じ作業ディレクトリからMPIを起動。 |
| [Time.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/OpenFOAM/db/Time/Time.C) | `Time::run()` の継続判定は `value() < endTime_ - 0.5*deltaT_`。`adjustDeltaT()` は `adjustableRunTime` 時の保存時刻に合わせ、要求された時間刻みを最大2倍に調整し得る。 |
| [VoF/setDeltaT.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/solvers/multiphase/VoF/setDeltaT.H) | Courant数による時間刻みを `maxDeltaT` で制限してから `runTime.setDeltaT()` へ渡す。保存時刻への整合処理はその後に実行される。 |

`p_rgh` は、加速度に伴って更新された `gh` を使う圧力変数になる。`constant/g` の数値だけを用いて `p_rgh + rho*g_base·x` を再構成すると、運動中のソルバーの `p` と一致しない。荷重評価時はソルバーが出力する `p` とその基準圧力を確認する。

## 検証状況

実施済み: `node --test tests/acceleration.test.cjs`。CSVの書式、時刻・単位・範囲検証、保存データ検証、符号・数値精度を保持するテーブル、ケース絶対パスを使う辞書構文、固定／自動時間刻みと保存時刻整合時の末尾余裕を検査した。これは辞書生成側の検査であり、OpenFOAMソルバーを実行した結果ではない。

未実施の確認手順: `interFoam` と `interIsoFoam` で各々、閉じた矩形容器・水／空気・静止メッシュを用いる。

1. ゼロ加速度を入力し、加速度機能を無効にした同条件との水量・流速・圧力の一致を確認する。
2. 容器のX加速度を一定 `+2 m/s²`、基礎重力を `(0 0 -9.81) m/s²` とし、十分減衰した自由表面の傾きが `dz/dx = -2/9.81` に向かうか確認する。これは軸と符号の独立した確認になる。
3. 符号反転、鉛直加速度、3成分同時入力、不等間隔時刻、データ端点を確認する。ログの実加速度が標本時刻で一致し、範囲外で停止することも確認する。
4. 時間刻み・自由表面付近メッシュを別々に細かくし、水面変位・壁面圧力／合力・水量収支への影響を評価する。振動数を扱う場合は解析解または公開実験と比較する。

回転運動や連成する容器変形を、この並進専用の確認結果から正当化しない。
