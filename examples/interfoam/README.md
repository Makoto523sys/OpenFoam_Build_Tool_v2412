# interFoam: STL初期水域・CSVスロッシング・界面自動細分化

同梱の `*.project.json` をリポジトリ直下の `OpenFOAM_v2412_case_builder_v8_4.html` のプロジェクト読込から開き、辞書生成・ZIP出力を行ってください。形状、材料、境界、初期水域STL、数値設定、監視設定、加速度CSVを保存しています。出力した辞書への追記は不要です。

## ケース

| プロジェクト | 内容 | 初期セル数 | 終了時刻 |
|---|---|---:|---:|
| damBreak_stl | STL水柱、厚み1セル・empty、固定メッシュ | 6,400 | 1 s |
| damBreak_coarse | 薄い3次元・前後対称、比較用固定メッシュ | 3,200 | 1 s |
| damBreak_amr | 比較用メッシュから最大1段階の自動細分化 | 3,200 | 1 s |
| damBreak_amr_level2 | 比較用メッシュから最大2段階の自動細分化 | 3,200 | 1 s |
| sloshing_csv | 1.2 × 0.8 × 3 m容器、水深1.2 m、加振20 s | 23,040 | 50 s |

全ケース interFoam・層流、上面は大気開放です。damBreakは標準的な水柱寸法を使う矩形・障害物なしの例です。OpenFOAMの障害物付きチュートリアルをそのまま再現したものではありません。領域は x=0..0.584, y=0..0.0146, z=0..0.584 m、水柱STLは最大座標 (0.1461 0.0146 0.292) mです。

初期水域には `searchableSurfaceToCell` と閉じたSTLを使います。STLは初期化専用で、メッシュを生成する障害物には入りません。セル中心による内外判定であり、界面を横切るセルの体積率を幾何積分する処理ではありません。

## 加速度

＋zが鉛直上向きで、基準重力 (0 0 -9.81) m/s² は解析中ずっと維持します。CSVは重力を含まない容器加速度です。

- t=0..20 s、間隔0.01 s、2001サンプル。
- ax=0.1 sin(2πt), ay=0.25 cos(πt/2), az=sin(2πt) [m/s²]。
- HTMLの「加速度の意味」は「容器加速度（重力を含まない）」、「末尾」は「加振終了後はゼロを追加」、追加間隔0.01 s。
- 入力の最終点20 sは元の値を保持し、20.01 sからゼロです。ay(20)=0.25なので終了部は不連続で、最後の0.01 sでゼロへ移ります。v2412はスプライン補間するため、その近傍では補間のオーバーシュートがあり得ます。テーパは追加していません。
- テーブルは終了時刻50 sと最終ステップの余裕を含む50.02 sまで出力します。元CSV、実入力 `container.csv`、変換条件 `conversion.json` がケースに残ります。
- 固定容器座標系の `tabulatedAccelerationSource` が `gEffective = g - aContainer` を適用します。CSVの符号を手作業で反転しません。

## 観測

スロッシングの4測線は (x,y)=(0.005,0.007), (1.195,0.007), (0.005,0.793), (1.195,0.793) m、測点z=0.025 m、方向 (0 0 -1) です。隅角から5〜7 mm内側です。メッシュ面の対角線と重なる測線はv2412の探索で無効値を生む場合があるため、xとyのオフセットをずらしています。

`postProcessing/cornerHeights/0/height.dat` の各測点の **hB** が底からの等価水深[m]です。hLは測点からの高さなので混同しないでください。0.01 s間隔を要求しますが、可変時間刻みでは実際の出力時刻が前後するため、時刻列を使用してください。飛沫や多重界面ではalphaの線積分による等価水深と最高波頂は一致しません。

短手方向に平行な壁はx=0とx=1.2のy-z面、`shortWall_x0` と `shortWall_xL` です。0.1 sごとの `postProcessing/wallSamples/<time>/*.vtp` にwallShearStress・rho・alpha.waterを保存します。interFoamのwallShearStressは動粘性基準[m²/s²]なので、Pa表示には同じ面のrhoを掛けてください。ベクトルの符号はOpenFOAMの定義を維持します。

## 自動細分化

HTMLのメッシュ方式を「VOF界面に合わせて自動細分化」に設定します。例は5ステップ間隔、界面判定0.001..0.999、最大セル数100000、追加レベル1または2です。dynamicRefineFvMeshは厚み方向も分割するためempty境界は拒否します。対称境界の薄い3次元ケースは厚み2セルを使用します。

`cellLevel` と `alpha.water` を同時に表示すると、細分化位置を確認できます。`log.interFoam` の `Refined from` / `Unrefined from` が細分化と粗視化の実行記録です。

## 自動再生成と検証

Node.jsとnpm依存関係を導入済みのリポジトリで:

```sh
npm run build
npm test
node scripts/generate-interfoam.cjs damBreak_amr_level2 /tmp/interfoam-examples
node scripts/generate-interfoam.cjs sloshing_csv /tmp/interfoam-examples
```

このスクリプトも実際のHTMLをjsdomで読み込み、GUIの入力項目・プロジェクト読込・STL/CSV読込・生成ボタンを通して出力します。辞書を別の実装で作成しません。既存のケースを上書きしません。OpenCFD OpenFOAM v2412の環境で、出力先ケースの `sh Allrun` を実行してください。

これらは生成機能と実行継続の検証例です。層流・粗い格子による壁面せん断応力の定量精度や実験との一致、メッシュ・時間刻み収束を保証する例ではありません。pisoFoamは今回の対象外です。

結果を図・CSV・Pa換算VTKへ整理する場合は、Pythonのnumpy・matplotlib・vtkを用意し、解析完了後に次を実行してください。スクリプトは解析出力を読み取るだけで、ケース設定は変更しません。

```sh
python3 scripts/analyze-interfoam.py amr /tmp/interfoam-examples
python3 scripts/analyze-interfoam.py sloshing /tmp/interfoam-examples
```

AMRの集計は表のdamBreak 4ケース全ての完了を前提とします。出力先は `<生成先>/results/` です。壁面分布は元のVTKに加え、`wallShearStress_Pa/<時刻>/` にPa換算場を保存します。
