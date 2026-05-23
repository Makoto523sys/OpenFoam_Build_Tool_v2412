# OpenFOAM v2412 Case Builder v3

v3 adds multi-geometry support for snappyHexMesh.

## Added in v3

- Multiple geometry file selection with a browser file picker.
- Geometry table: file, name/patch, type, patchType, refinement min/max, feature level, eMesh file, and layer count.
- Generated `system/snappyHexMeshDict` now expands every geometry into:
  - `geometry`
  - `castellatedMeshControls/features`
  - `castellatedMeshControls/refinementSurfaces`
  - `addLayersControls/layers`
- Generated `system/surfaceFeatureExtractDict` now includes all geometry files.
- Selected local geometry files are bundled into the exported case ZIP under `constant/triSurface/`.
- If no geometry file is selected, the exported case ZIP includes `constant/triSurface/README_put_geometry_files_here.txt`.

## Recommended workflow

1. Open `OpenFOAM_v2412_case_builder_v3.html` in a browser.
2. In section 9, select one or more STL/OBJ files.
3. Adjust each row's `name`, `patchType`, refinement levels, feature level, and layers.
4. Download the case ZIP.
5. Extract it in WSL, preferably under `~/OpenFOAM/$USER-v2412/run`.
6. Run `surfaceFeatureExtract`, `snappyHexMesh -overwrite`, then `checkMesh`.

