/* Initial-water surfaces are independent of snappyHexMesh geometry.
 * Coordinates remain in the source STL units until exportSTL is called.
 * v2412 source evidence and selection semantics: docs/water-region-evidence.md.
 */
const WaterRegion = (() => {
  const geometry = () => typeof Geometry !== 'undefined' ? Geometry : require('./geometry.js');
  const key = v => v.map(x => x === 0 ? '0' : String(x)).join(',');

  function asBuffer(input) {
    if (input instanceof ArrayBuffer) return input;
    if (ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    throw Error('初期水領域はSTLファイルで読み込んでください。');
  }

  // Do not weld nearby vertices: a small open seam is still an open surface.
  // Matching is exact, and no vertices or winding are silently repaired.
  function closedTopology(faces) {
    const vertices = new Map(), edges = new Map(), faceVertices = [], neighbors = faces.map(() => []);
    faces.forEach((face, index) => {
      const ids = face.v.map(v => {
        const k = key(v);
        if (!vertices.has(k)) vertices.set(k, {id: vertices.size, faces: []});
        const vertex = vertices.get(k);
        vertex.faces.push(index);
        return vertex.id;
      });
      faceVertices.push(ids);
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3], k = a < b ? a + ':' + b : b + ':' + a;
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({face: index, direction: a < b ? 1 : -1});
      }
    });
    let open = 0, nonManifold = 0, inconsistent = 0;
    for (const edge of edges.values()) {
      if (edge.length === 1) open++;
      else if (edge.length !== 2) nonManifold++;
      else {
        if (edge[0].direction === edge[1].direction) inconsistent++;
        neighbors[edge[0].face].push(edge[1].face);
        neighbors[edge[1].face].push(edge[0].face);
      }
    }
    if (open || nonManifold) throw Error(`初期水領域STLは閉じた形状が必要です。開いた辺: ${open}、非多様体の辺: ${nonManifold}。CADで修復して読み直してください。`);
    if (inconsistent) throw Error(`初期水領域STLの三角形の向きが不一致です（${inconsistent}辺）。面の向きをCADでそろえてください。`);

    // Edge-manifold meshes can still have a pinched (non-manifold) vertex.
    for (const vertex of vertices.values()) {
      const seen = new Set([vertex.faces[0]]), queue = [vertex.faces[0]];
      for (let q = 0; q < queue.length; q++) for (const other of neighbors[queue[q]]) {
        if (!seen.has(other) && faceVertices[other].includes(vertex.id)) {seen.add(other); queue.push(other);}
      }
      if (seen.size !== vertex.faces.length) throw Error('初期水領域STLに頂点だけで接する非多様体の箇所があります。独立した領域に分けてください。');
    }
    const seen = new Set([0]), queue = [0];
    for (let q = 0; q < queue.length; q++) for (const other of neighbors[queue[q]]) {
      if (!seen.has(other)) {seen.add(other); queue.push(other);}
    }
    if (seen.size !== faces.length) throw Error('初期水領域STLは1ファイルにつき1つの連結した閉曲面にしてください。離れた領域・入れ子の閉曲面は別々に分けてください。');
    return {neighbors, open, nonManifold, inconsistent, components: 1, vertices: vertices.size, edges: edges.size};
  }

  function prepareFaces(sourceFaces, {scale = 1} = {}) {
    if (!Number.isFinite(scale) || scale <= 0) throw Error('初期水領域STLの単位係数は正の有限値にしてください。');
    if (!Array.isArray(sourceFaces) || !sourceFaces.length || sourceFaces.length > 500000) throw Error('初期水領域STLは1〜50万三角形で指定してください。');
    const G = geometry(), faces = sourceFaces.map(face => {
      if (!face || !Array.isArray(face.v) || face.v.some(v => !Array.isArray(v))) throw Error('初期水領域STLの三角形データが不正です。');
      return G.triangle(face.v.map(v => v.slice()), face.region || 'initialWater');
    }), bounds = G.bounds(faces);
    if (faces.some(f => f.n.some(x => !Number.isFinite(x)))) throw Error('初期水領域STLの座標が大きすぎるか、三角形を正しく評価できません。');
    const extent = G.sub(bounds.max, bounds.min);
    if (extent.some(x => !Number.isFinite(x) || x <= 0)) throw Error('初期水領域STLは体積を持つ3次元の閉曲面にしてください。');
    const boundsMeters = {min: bounds.min.map(x => x * scale), max: bounds.max.map(x => x * scale)};
    if ([...boundsMeters.min, ...boundsMeters.max].some(x => !Number.isFinite(x))) throw Error('初期水領域STLの単位変換後の座標が有限値ではありません。');
    const topology = closedTopology(faces);

    // Translate the volume integral near the body to reduce cancellation.
    let volume = 0, correction = 0;
    for (const face of faces) {
      const [a, b, c] = face.v.map(v => G.sub(v, bounds.min));
      const term = G.dot(a, G.cross(b, c)) / 6 - correction;
      const sum = volume + term;
      correction = (sum - volume) - term;
      volume = sum;
    }
    if (!Number.isFinite(volume) || Math.abs(volume) <= extent.reduce((p, x) => p * x, 1) * 1e-12 || volume === 0) throw Error('初期水領域STLの体積を正しく求められません。重複面・自己交差・極端な寸法を確認してください。');
    if (volume < 0) throw Error('初期水領域STLの面が内向きです。水領域の外側へ向くようCADで面の向きを反転してください。');
    const volumeMeters3 = volume * scale ** 3;
    if (!Number.isFinite(volumeMeters3) || volumeMeters3 <= 0) throw Error('初期水領域STLの単位変換後の体積を正しく評価できません。');
    return {
      faces, topology, bounds, boundsMeters, scale, volume, volumeMeters3,
      warnings: ['セル中心が閉曲面の内側にあるセルを初期化します。界面セルの水体積率を幾何学的に積分する処理ではありません。', '自己交差と実メッシュとの位置関係は、surfaceCheckとParaViewで確認してください。']
    };
  }

  function prepare(input, options = {}) {
    return prepareFaces(geometry().parseSTL(asBuffer(input)), options);
  }

  function exportSTL(prepared) {
    if (!prepared || !Array.isArray(prepared.faces)) throw Error('初期水領域STLを読み込んでください。');
    if (!Number.isFinite(prepared.scale) || prepared.scale <= 0) throw Error('初期水領域STLの単位係数は正の有限値にしてください。');
    // Use round-trippable JS number strings, not the workbench's 12-digit
    // formatting: rounding a small feature could collapse distinct vertices.
    const G = geometry(), out = ['solid initialWater'];
    for (const face of prepared.faces) {
      const scaled = G.triangle(face.v.map(v => v.map(x => x * prepared.scale)), 'initialWater');
      if (scaled.n.some(x => !Number.isFinite(x))) throw Error('初期水領域STLの単位変換後の面を正しく評価できません。');
      out.push('  facet normal ' + scaled.n.join(' '), '    outer loop');
      for (const vertex of scaled.v) out.push('      vertex ' + vertex.join(' '));
      out.push('    endloop', '  endfacet');
    }
    out.push('endsolid initialWater');
    return out.join('\n') + '\n';
  }

  function selectionBody({file, alpha = 1} = {}) {
    // The file override is relative to the IOobject's constant/triSurface
    // directory; restrict the optional subfolder to the dedicated water folder.
    if (typeof file !== 'string' || !/^(?:initialWater\/)?[A-Za-z_][A-Za-z0-9_-]*\.stl$/i.test(file)) throw Error('初期水領域の出力STL名が不正です。英数字・_・-と専用のinitialWaterフォルダーだけ使用できます。');
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw Error('初期水領域のalpha.waterは0から1の有限値にしてください。');
    return `    searchableSurfaceToCell\n    {\n        surfaceType triSurfaceMesh;\n        surfaceName initialWaterSelection;\n        file "${file}";\n        fieldValues\n        (\n            volScalarFieldValue alpha.water ${alpha}\n        );\n    }\n`;
  }

  return {prepare, prepareFaces, exportSTL, selectionBody};
})();
if (typeof module !== 'undefined') module.exports = WaterRegion;
