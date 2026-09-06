# 優先検証結果・ChatGPT Work 引き継ぎ（2026-09-06〜07）

pimpleFoamを優先し、解析解比較・2並列・途中再開を実行した。interFoamではAMR damBreakとCSV加振の並列・再開、静水保持、一定加速度による水面傾斜を確認した。以下はOpenCFD OpenFOAM v2412 patch260127での実計算結果であり、全用途の精度保証ではない。pisoFoamは最低限の登録と起動確認まで実施済みだが、ユーザー指示により追加検証を後回しにする。

## 修正した不具合

1. AMR並列計算の終了後、reconstructParのみではpointProcAddressing不足で再構成に失敗した。HTML出力のAllrunにreconstructParMeshを先行させる処理を追加した。
2. 途中再開でもAllrunがメッシュと初期水柱を作り直す問題があった。「実行モード：保存時刻から再開」をHTMLに追加した。再開時はメッシュ生成・topoSet・setFieldsを省略し、明示した正のstartTimeから開始する。2並列再開は再構成済みの単一ケースの保存時刻をdecomposePar -force -timeで再分割する。再開ログは.restart付きになる。
3. AMR保存メッシュの平面上の分割面を、checkMesh -allGeometryがconcaveとして報告し、再開を阻止した。AMR再開に限り、詳細検査の唯一の失敗がこの検査である場合に、全セルの面平面・凸性を独立検査し、通常checkMeshも通過したときだけ許容する。詳細失敗ログは保持する。本当に凹形のセル、他の品質不良、異常終了は許容しない。cellLevel・pointLevel・refinementHistoryの欠落も拒否する。
4. pisoFoamが未登録だったため選択肢とPISO辞書を追加した。v2412の固定時間刻みに合わせ、adjustTimeStep=yesを拒否する。追加の精度検証は保留。

## pimpleFoam

平行平板間の始動Poiseuille流。領域1×0.1×0.01 m、40×40×1セル、動粘度0.01 m²/s、入口・出口の動圧差0.1 m²/s²、初期速度0、Euler時間積分、dt=0.001 s、終了1 s。平板法線をy、流れ方向をxとした。解析解は定常放物線分布と奇数次Fourier級数による過渡項の和で評価した。

| 時刻 s | 速度の解析解に対する相対L2誤差 % |
|---:|---:|
| 0.01 | 0.702091 |
| 0.1 | 0.248002 |
| 0.5 | 0.0686038 |
| 1 | 0.085327 |

RAS kOmegaSSTは0.05 sまで正常終了した。ただし、これは辞書・境界条件・実行確認であり、乱流モデルの定量検証ではない。

## 並列・再開比較

各値は対応する直列連続計算との差。場は終了時刻でセル中心位置を照合して比較し、波高は再開後も含めた出力時刻で比較した。場の値はASCII保存データを倍精度で読み、VTKはセル位置の照合に使用した。相対L2はセル値ベクトルのノルムであり、体積重み付きではない。

| ケース | 速度 相対L2 % | alpha.water 最大絶対差 | 波高 最大差 mm |
|---|---:|---:|---:|
| pimple_parallel | 2.82475e-09 | — | — |
| pimple_restart | 1.56903e-14 | — | — |
| amr_parallel | 0.373678 | 0.0148517 | 0.000479688 |
| amr_restart | 0.000492254 | 3.34414e-06 | 0.00129117 |
| csv_parallel | 1.98794 | 0.000114871 | 0.0134056 |
| csv_restart | 0.000325032 | 1.33711e-07 | 0.000159625 |
| amr_parallel_tight | 0.373772 | 0.014858 | 0.000455879 |
| csv_parallel_tight | 1.97046 | 4.49862e-05 | 0.00661759 |
| pimple_parallel_restart | 2.70073e-09 | — | — |
| amr_parallel_restart | 0.695573 | 0.0259974 | 0.0295175 |
| csv_parallel_restart | 1.23616 | 8.68999e-05 | 0.00951201 |

pimpleFoamは1 s終了、0.5 s保存からの直列再開と2並列再開を確認した。
AMRは3200初期セル、最終5216セル、dt=0.0005 s、終了0.2 s、再開0.1 s。STLで水柱を初期化し、VOF界面の細分化を有効にした。直列・並列の終了時メッシュ位置とセル数は一致した。
CSV加振は1.2×0.8×3 m、初期水位1.2 m、12×8×30セル、dt=0.01 s、終了21 s、再開10.25 s。前回の23040セル・50 s完走とは別の比較用粗格子で、加振中の再開と加振終了後までを確認した。

CSVはt=0〜20 sを0.01 s刻み、ax=0.1 sin(2πt)、ay=0.25 cos(πt/2)、az=sin(2πt) m/s²。CSVに重力を含めず、+z上向き、g=(0,0,-9.81) m/s²を別途維持する。20 sの最終標本から20.01 sのゼロ標本へ線形補間され、その後はゼロ。再開時もCSVの絶対時刻を保持する。

「tight」は線形ソルバーのp許容値・場許容値を1e-11、pのrelTolを0にした比較。AMRの局所差はほぼ変わらず、CSVの界面・波高差は減ったが速度場の完全一致は得られなかった。正常終了・再構成・再開の機能確認はできたが、局所VOF差まで解消したとは判断しない。

## 重力・加速度の基礎確認

同じ容器の粗格子で50 sまで計算した。無加振CSVは全軸ゼロ。一定加速度CSVはax=0.981、ay=az=0 m/s²で、どちらも重力は別途存在する。

無加振の45〜50 sの隅角水位は、1.2 mから最大0.00418001 mm、各点の変動幅は最大0.000502776 mm。ただし50 sの最大流速は0.00433915 m/sあり、水位安定だけで完全な静水平衡と判定してはいけない。

一定加速度の理論勾配はdh/dx=-0.1。壁から離れた4点の45〜50 s平均から得た勾配は-0.10017541、理論水位との最大差は0.152257 mmだった。隅角観測点では最大4.57841 mmの差があり、0.1 m格子と壁近傍の補間・外挿の影響を受ける。隅角波高の精度が必要なら壁近傍の格子収束確認が必要。内部4点はHTMLで観測点を変更し、保存済み45〜50 sの場をinterFoam -postProcessで評価した。

静水の追加比較 gravity_static_tight では、HTMLからpTol=1e-11、pRelTol=0、fieldTol=1e-11に変更し、50 sまで再計算した。最大流速は2.49443e-9 m/sに低下し、45〜50 sの水位誤差・変動は保存精度内でゼロだった。標準条件での残留流速は収束条件に強く依存することが確認できた。静水保持や小さい壁面せん断応力の評価には、この厳しい設定を起点に収束確認を行う。全ケースへの一律の既定値変更はしていない。

## 再現方法

全ケースの設定はexamples/priority-validation/*.project.jsonからHTMLに読み込める。設定・辞書はHTMLのGUI状態と生成ボタンを介して出力した。OpenFOAM辞書を後から手編集して検証条件を作ってはいない。STL・CSVもプロジェクトに保存されている。

自動生成する場合はリポジトリでnpm ci、npm run build後、次を実行する（OpenFOAM v2412をsourceする）。

```sh
node scripts/generate-priority-validation.cjs pimple_poiseuille /tmp/priority_validation
cd /tmp/priority_validation/pimple_poiseuille
sh Allrun
```

他のケース名はプロジェクトファイル名から.project.jsonを除いたもの。出力先に同名ケースがあれば上書きを拒否する。再開ケースには、対応する直列連続計算のconstant/polyMeshと保存時刻ディレクトリ全体をコピーしてからAllrunする。pimpleは0.5、amrは0.1、csvは10.25を使う。これは計算結果の受け渡しであり、辞書の編集ではない。AMRの保存時刻内polyMeshと細分化履歴も必須。並列計算だけのprocessorディレクトリを直接再開入力にはできない。先に単一ケースへ再構成する。

解析スクリプトはPython3とnumpy、matplotlib、vtkを使用する。

```sh
python3 scripts/analyze-pimple-validation.py pimple_poiseuille /tmp/priority_validation
python3 scripts/compare-priority-validation.py /tmp/priority_validation
python3 scripts/analyze-acceleration-basics.py /tmp/priority_validation
```

事前に出力先のresultsディレクトリを作成する。gravity_tilt_interiorはgravity_tiltのメッシュと45〜50 s保存場をコピーし、HTMLが生成した観測設定でinterFoam -postProcess -time '45:50'を実行した。

## 検証の限界と次の優先順位

1. 収束条件を十分厳しくしたうえで、波高・壁面せん断応力の格子・時間刻み依存性を確認する。特に粗格子の隅角測定誤差を定量評価する。
2. AMRの並列数・分割方法・PIMPLE反復条件に対する局所alpha差の感度確認。現時点で2並列だけを確認した。
3. pimpleFoamの実用途に近い乱流・複雑形状での検証。今回のRASは起動確認に限る。
4. CSV加振とAMRの同時使用は現状のサポート対象外。今回、別々のケースとして検証した。
5. pisoFoamの追加検証はユーザー指示により後回し。

最終回帰テストは140件すべて成功。凸セル・真の凹セル・適用外品質不良に対するPythonテスト3件も含む。最新版HTMLから出したAMR再開ケースで、正しい保存履歴を通過させ、refinementHistory欠落を拒否することもOpenFOAM実機で確認した。

ローカル実計算・ログはpriority_validation/、集計値と図はresults/に保持した。前回のinterFoam 50 s試験や壁面せん断応力VTKの結果はinterFoam_validation/に残している。GitHubにはプロジェクト設定、再現スクリプト、集計結果と図を収録し、大量の場・メッシュは含めない。
