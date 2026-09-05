const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/geometry.js');
const W = require('../src/water-region.js');
const encode = text => new TextEncoder().encode(text).buffer;
const stl = faces => encode(G.exportSTL(faces));

function cube(min = [0, 0, 0], max = [1, 1, 1]) {
  const p = [[0,0,0], [1,0,0], [1,1,0], [0,1,0], [0,0,1], [1,0,1], [1,1,1], [0,1,1]].map(v => v.map((x, i) => x ? max[i] : min[i]));
  return [[0,2,1], [0,3,2], [4,5,6], [4,6,7], [0,1,5], [0,5,4], [3,7,6], [3,6,2], [0,4,7], [0,7,3], [1,2,6], [1,6,5]].map(ids => G.triangle(ids.map(i => p[i].slice()), 'tankWall'));
}

test('initial-water geometry retains coordinates and converts units exactly once on export', () => {
  const water = W.prepare(stl(cube([100,200,300], [1100,2200,3300])), {scale: .001});
  assert.deepEqual(water.bounds, {min:[100,200,300], max:[1100,2200,3300]});
  assert.deepEqual(water.boundsMeters, {min:[.1,.2,.3], max:[1.1,2.2,3.3000000000000003]});
  assert.equal(water.topology.open, 0);
  assert.equal(water.topology.nonManifold, 0);
  assert.equal(water.topology.components, 1);
  assert.equal(water.volume, 6e9);
  assert.ok(Math.abs(water.volumeMeters3 - 6) < 1e-14);
  const out = W.exportSTL(water), parsed = G.parseSTL(encode(out));
  assert.deepEqual(G.bounds(parsed), water.boundsMeters);
  assert.equal(W.exportSTL(water), out);
  assert.equal(water.faces[0].patch, 'tankWall');
  assert.equal(parsed[0].region, 'initialWater');
  assert.ok(G.contains(parsed, [.5,1,1]));
  assert.ok(!G.contains(parsed, [2,1,1]));
});

test('binary STL and a typed buffer view are accepted without reading bytes outside the view', () => {
  const faces = cube(), padded = new Uint8Array(84 + 50 * faces.length + 32), view = new DataView(padded.buffer, 16, 84 + 50 * faces.length);
  view.setUint32(80, faces.length, true);
  faces.forEach((f, i) => f.v.flat().forEach((n, k) => view.setFloat32(84 + i * 50 + 12 + k * 4, n, true)));
  assert.equal(W.prepare(padded.subarray(16, padded.length - 16)).volume, 1);
});

test('open shells, duplicate faces, inconsistent winding and inward shells are rejected', () => {
  const faces = cube();
  assert.throws(() => W.prepare(stl(faces.slice(1))), /開いた辺/);
  assert.throws(() => W.prepare(stl([...faces, faces[0]])), /非多様体/);
  const mixed = faces.map((f, i) => i ? f : G.triangle([...f.v].reverse()));
  assert.throws(() => W.prepare(stl(mixed)), /向きが不一致/);
  const inward = faces.map(f => G.triangle([...f.v].reverse()));
  assert.throws(() => W.prepare(stl(inward)), /内向き/);
});

test('an open seam smaller than the workbench welding tolerance is still rejected', () => {
  const faces = cube();
  faces[0] = G.triangle(faces[0].v.map((v, i) => i ? v : [1e-10,0,0]));
  assert.equal(G.topology(faces).open, 0);
  assert.throws(() => W.prepare(stl(faces)), /開いた辺/);
});

test('disconnected/nested shells and surfaces touching at one vertex are rejected explicitly', () => {
  assert.throws(() => W.prepare(stl([...cube(), ...cube([2,0,0],[3,1,1])])), /1ファイルにつき1つ/);
  assert.throws(() => W.prepare(stl([...cube(), ...cube([.2,.2,.2],[.8,.8,.8])])), /1ファイルにつき1つ/);
  assert.throws(() => W.prepare(stl([...cube(), ...cube([1,1,1],[2,2,2])])), /頂点だけで接する/);
});

test('non-finite coordinates, empty input, zero-volume shapes and invalid scale are rejected', () => {
  assert.throws(() => W.prepare(new ArrayBuffer(0)));
  assert.throws(() => W.prepare('not an STL'));
  const good = stl(cube());
  for (const scale of [0, -1, NaN, Infinity, 1e200, 1e-200, '.001']) assert.throws(() => W.prepare(good, {scale}));
  assert.throws(() => W.prepare(encode(G.exportSTL(cube()).replace('vertex 0 0 0', 'vertex NaN 0 0'))));
  const triangle = G.triangle([[0,0,0],[1,0,0],[0,1,0]]);
  assert.throws(() => W.prepare(stl([triangle, G.triangle([...triangle.v].reverse())])), /体積を持つ/);
});

test('translation does not corrupt signed-volume orientation checks', () => {
  const water = W.prepare(stl(cube([1e8,1e8,1e8], [1e8 + 1,1e8 + 2,1e8 + 3])));
  assert.equal(water.volume, 6);
});

test('restoring project faces does not round small features or trust stored normals', () => {
  const source = cube([1,0,0], [1 + 1e-13,1,1]).map(f => ({v:f.v, region:f.region, n:[NaN,NaN,NaN]}));
  const original = structuredClone(source);
  const prepared = W.prepareFaces(source, {scale:.001});
  assert.deepEqual(source, original);
  assert.notEqual(prepared.faces[0].v, source[0].v);
  assert.ok(prepared.faces.every(f => f.n.every(Number.isFinite)));
  const exported = W.exportSTL(prepared);
  const restored = W.prepare(encode(exported));
  assert.ok(restored.volume > 0);
  assert.deepEqual(restored.bounds, prepared.boundsMeters);
  assert.throws(() => W.prepareFaces([{v:[[0,0,0], [1,0,0], [0,NaN,0]]}]), /不正な座標/);
  assert.throws(() => W.prepareFaces([]), /三角形/);
  assert.throws(() => W.prepareFaces([null]), /不正/);
});

test('a concave closed water region is accepted without replacing it by its bounding box', () => {
  // Concave L-shaped prism with an outward-oriented triangulation.
  const polygon = [[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]];
  const p = polygon.map(([x,y]) => [x,y,0]).concat(polygon.map(([x,y]) => [x,y,1]));
  const faces = [];
  for (const [a,b,c] of [[0,1,3], [1,2,3], [0,3,5], [3,4,5]]) {
    faces.push(G.triangle([p[a],p[c],p[b]]), G.triangle([p[a+6],p[b+6],p[c+6]]));
  }
  for (let a = 0; a < 6; a++) {
    const b = (a + 1) % 6;
    faces.push(G.triangle([p[a],p[b],p[b+6]]), G.triangle([p[a],p[b+6],p[a+6]]));
  }
  const water = W.prepare(stl(faces));
  assert.equal(water.volume, 3);
  assert.ok(G.contains(water.faces, [.5,1.5,.5]));
  assert.ok(!G.contains(water.faces, [1.5,1.5,.5]));
});

test('v2412 setFields uses the registered source and a file relative to constant/triSurface', () => {
  assert.equal(W.selectionBody({file:'initialWater/water_fill_1.stl'}), `    searchableSurfaceToCell
    {
        surfaceType triSurfaceMesh;
        surfaceName initialWaterSelection;
        file "initialWater/water_fill_1.stl";
        fieldValues
        (
            volScalarFieldValue alpha.water 1
        );
    }
`);
  assert.match(W.selectionBody({file:'water_fill_1.stl', alpha:.5}), /alpha\.water 0\.5\n/);
  assert.doesNotMatch(W.selectionBody({file:'water_fill_1.stl'}), /outsidePoints|includeCut|scale|snappy|patchInfo/);
  for (const file of ['', '../water.stl', 'constant/triSurface/water.stl', 'water.stl;bad', 'water.stl\n', 'water".stl', '$FOAM_CASE.stl']) assert.throws(() => W.selectionBody({file}));
  for (const alpha of [-.1, 1.1, NaN, Infinity, '1']) assert.throws(() => W.selectionBody({file:'water.stl', alpha}));
});
