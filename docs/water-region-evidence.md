# STLによる初期水領域: OpenCFD OpenFOAM-v2412

2026-09-05、公式GitLabの `OpenFOAM-v2412` tagからソースを取得して照合した。Foundation版の仕様ではない。

| 確認対象 | 公式ソース | 確認結果 |
|---|---|---|
| setFieldsの領域指定 | [setFields.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/utilities/preProcessing/setFields/setFields.C) | `regions` のキーワードから `topoSetSource::New` を呼び、CELLSET_SOURCEの選択セルに `fieldValues` を適用する。独立したtopoSet実行やcellSetファイルは不要。 |
| STL内部の選択 | [searchableSurfaceToCell.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/meshTools/topoSet/cellSources/searchableSurfaceToCell/searchableSurfaceToCell.C) | topoSetSourceへの登録あり。`surfaceType` を読み、`constant/triSurface` をIOobjectの場所に設定する。セル中心のvolumeTypeがINSIDEのセルを選択する。閉じていない面は警告して無視する。 |
| 入力条件 | [searchableSurfaceToCell.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/meshTools/topoSet/cellSources/searchableSurfaceToCell/searchableSurfaceToCell.H) | `surfaceType` は必須、`surfaceName` はIOobject名を指定する任意入力。 |
| 三角形表面の判定 | [triSurfaceMesh.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/meshTools/searchableSurfaces/triSurfaceMesh/triSurfaceMesh.C) | 閉曲面かを `hasVolumeType` で確認し、`getVolumeType` は向きに基づく内外判定を行う。 |
| 初期水専用フォルダー | [triSurface.H](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/surfMesh/triSurface/triSurface.H)、[triSurfaceIO.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/surfMesh/triSurface/triSurfaceIO.C) | `file` 指定の相対パスはIOobjectの場所から解決される。`file "initialWater/water.stl"` は `constant/triSurface/initialWater/water.stl` を指す。surfaceNameにはフォルダーパスを入れない。 |
| 比較した別方式 | [surfaceToCell.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/src/meshTools/topoSet/cellSources/surfaceToCell/surfaceToCell.C) | 通常のinside/cut選択ではoutsidePointsが実セル内にある必要がある。今回のセル中心による選択に不要な外側点をユーザーに要求しないためsearchableSurfaceToCellを採用。 |
| 自己交差の確認 | [surfaceCheck.C](https://gitlab.com/openfoam/core/openfoam/-/blob/OpenFOAM-v2412/applications/utilities/surface/surfaceCheck/surfaceCheck.C) | `-checkSelfIntersection` で自己交差を確認できる。ただし自己交差検出時も通常終了コード0なので、終了コードだけでは合格と判定できない。 |

## 分離と選択の意味

- 初期水STLはメッシュ境界用STLとは別の入力・状態・用途で扱い、`constant/triSurface/initialWater/` へ出力する。snappyHexMeshのgeometry、refinementSurfaces、feature抽出、パッチ一覧へ追加しない。
- 初期水STLは水を入れたい領域の**体積を囲む閉曲面**である。水面だけの開いた面は受け付けない。
- STL座標は読込時に保持し、STL固有の単位係数を出力時に一度だけ掛けてmにする。メッシュSTLの単位設定と独立している。
- 対象は1ファイルにつき1つの連結した閉曲面。辺の閉鎖、非多様体の辺・頂点、三角形の向き、正の有向体積を検査する。凹形状や穴を持つ連結した形状も扱える。離れた閉曲面・入れ子のシェルを1ファイルにまとめた入力は、向き依存の内外判定の誤りを避けるため拒否する。
- 頂点の接続は座標の完全一致で確認する。隙間を許容値で埋めたり、内向き面を自動反転したりしない。メッシュ用途の面選択に使う近接頂点の判定とは目的が違う。
- セル中心が水領域内にあれば、そのセル全体を `alpha.water = 1` にする。STLと交差するセルでも、セル中心が外なら水にしない。セル中心が表面上にある場合はOpenFOAMの幾何判定・許容値に依存する。
- セル内の水体積を積分して0〜1の界面体積率を求める機能ではない。初期水量はメッシュ依存なので、`sum(alpha.water * V)` と想定体積を比較し、界面付近を細かくする。
- ブラウザー側の閉鎖・向き検査では、すべての自己交差までは検証していない。`surfaceCheck -checkSelfIntersection <STL>` のログと、実際にsetFieldsしたalpha.waterを確認する。

## モジュールと検証

`src/water-region.js` は `prepare(input, {scale})` で検査済みの元座標faces・境界箱・m換算境界箱・体積を返す。`prepareFaces(sourceFaces, {scale})` はプロジェクト復元用で、頂点をコピーし法線を計算し直して同じ検査を行う。`exportSTL(prepared)` は初期水専用のsolid名でm座標を出力する。出力はJavaScriptの数値を往復できる桁数を保ち、細かい形状を12桁への丸めで潰さない。`selectionBody({file, alpha})` はsetFieldsのregions内へ入れる選択エントリーを返す。

生成する `system/setFieldsDict` の例（`file` は `constant/triSurface` からの相対パス）:

```foam
defaultFieldValues
(
    volScalarFieldValue alpha.water 0
);
regions
(
    searchableSurfaceToCell
    {
        surfaceType triSurfaceMesh;
        surfaceName initialWaterSelection;
        file "initialWater/water.stl";
        fieldValues
        (
            volScalarFieldValue alpha.water 1
        );
    }
);
```

`tests/water-region.test.cjs` は単位の一度だけの適用、binary STL、凹形状、微小な隙間、開いた面、重複面、向き不一致、内向き面、非多様体頂点、連結性、無効座標、ネイティブ辞書の構造を確認する。OpenFOAM本体での実行確認は別途必要。
