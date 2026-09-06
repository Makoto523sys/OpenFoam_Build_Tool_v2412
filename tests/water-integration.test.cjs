const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./helpers.cjs');
const G = require('../src/geometry.js');
const plain = value => JSON.parse(JSON.stringify(value));

function cube(min = [0,0,0], max = [1,1,1], region = 'initialFill') {
  const points = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(v => v.map((x,i) => x ? max[i] : min[i]));
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].map(ids => G.triangle(ids.map(i => points[i].slice()), region));
}

function fileFor(a, name = 'water.stl', faces = cube()) {
  const bytes = new TextEncoder().encode(G.exportSTL(faces));
  return {name, size:bytes.byteLength, arrayBuffer:async () => {
    // A browser File.arrayBuffer() returns an ArrayBuffer in the page's realm.
    const buffer = new a.w.ArrayBuffer(bytes.byteLength);
    new a.w.Uint8Array(buffer).set(bytes);
    return buffer;
  }};
}

function waterApp() {
  const a = app();
  a.set('includeSnappy', false);
  a.set('solver', 'interFoam');
  a.set('waterRegionMode', 'stl');
  return a;
}

async function downloadedZip(a) {
  let blob;
  a.w.URL.createObjectURL = value => {blob = value; return 'blob:test-download';};
  a.w.URL.revokeObjectURL = () => {};
  a.w.HTMLAnchorElement.prototype.click = () => {};
  a.click('downloadZip');
  assert.ok(blob, 'ZIP should be downloadable: ' + a.api.blockingErrors().join(', '));
  const bytes = await new Promise((resolve, reject) => {
    const reader = new a.w.FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const result = require('node:child_process').spawnSync('python', ['-c', 'import io,sys,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))'], {input:bytes});
  assert.equal(result.status, 0, result.stderr.toString());
  return JSON.parse(result.stdout);
}

test('initial-water STL has a dedicated output path and never creates mesh geometry, features or patches', async () => {
  const a = waterApp();
  try {
    await a.api.importGeometryFiles([fileFor(a, 'water.stl', cube([-2,-2,-2],[2,2,2], 'meshWall'))]);
    const patchNames = plain(a.api.getPatches().map(p => p.name));
    await a.api.importWaterRegionFile(fileFor(a, 'water.stl', cube([-.5,-.5,-.5],[.5,.5,.5], 'initialFill')));
    a.set('includeSnappy', true);
    const waterPath = 'constant/triSurface/' + a.api.waterOutputName();
    assert.equal(waterPath, 'constant/triSurface/initialWater/water.stl');
    const zip = await downloadedZip(a), root = a.d.getElementById('caseName').value;
    assert.ok(zip[root + '/constant/triSurface/water.stl']);
    assert.equal(zip[root + '/' + waterPath], a.file(waterPath));
    assert.ok(a.file(waterPath));
    assert.notEqual(a.file(waterPath), zip[root + '/constant/triSurface/water.stl']);
    assert.equal(a.api.geometryParts.size, 1);
    assert.deepEqual(plain(a.api.getPatches().map(p => p.name)), patchNames);
    assert.match(a.file('system/snappyHexMeshDict'), /water\.stl/);
    assert.doesNotMatch(a.file('system/snappyHexMeshDict'), /initialWater|initialFill/);
    assert.match(a.file('system/surfaceFeatureExtractDict'), /water\.stl/);
    assert.doesNotMatch(a.file('system/surfaceFeatureExtractDict'), /initialWater|initialFill/);
    assert.match(a.file('system/setFieldsDict'), /searchableSurfaceToCell/);
    assert.match(a.file('system/setFieldsDict'), /file "initialWater\/water\.stl";/);
    assert.doesNotMatch(a.file('system/setFieldsDict'), /boxToCell/);
    assert.doesNotMatch(a.file('0/alpha.water'), /initialFill|initialWater/);
    const allrun = a.file('Allrun');
    assert.ok(allrun.indexOf('snappyHexMesh') < allrun.indexOf('runFresh setFields'));
    assert.equal(a.errors.length, 0);
  } finally {a.close();}
});

test('water STL unit selection scales once and stays independent of the meshing STL units', async () => {
  const a = waterApp();
  try {
    a.set('stlScale', '0.01');
    a.set('waterRegionScale', '0.001');
    await a.api.importWaterRegionFile(fileFor(a, 'millimetres.stl', cube([100,200,300],[1100,2200,3300])));
    const path = 'constant/triSurface/' + a.api.waterOutputName();
    const bounds = () => G.bounds(G.parseSTL(new TextEncoder().encode(a.file(path)).buffer));
    const once = a.file(path);
    assert.deepEqual(bounds(), {min:[.1,.2,.3], max:[1.1,2.2,3.3000000000000003]});
    assert.deepEqual(plain(a.api.projectSnapshot().auxiliary.water.faces[0].v[0]), [100,200,300]);
    a.click('generateBtn');
    a.set('stlScale', '1');
    assert.equal(a.file(path), once);
    a.set('waterRegionScale', '0.01');
    assert.deepEqual(bounds(), {min:[1,2,3], max:[11,22,33]});
    a.set('waterRegionScale', '0.001');
    assert.equal(a.file(path), once);
    assert.deepEqual(plain(a.api.blockingErrors()), []);
  } finally {a.close();}
});

test('box and STL modes switch selection without mixing their validation or output', async () => {
  const a = waterApp();
  try {
    await a.api.importWaterRegionFile(fileFor(a));
    a.set('waterBoxMin', '(NaN 0 0)');
    assert.deepEqual(plain(a.api.blockingErrors()), []);
    assert.equal(a.d.getElementById('waterBoxControls').hidden, true);
    assert.equal(a.d.getElementById('waterSTLControls').hidden, false);
    const path = 'constant/triSurface/' + a.api.waterOutputName(), surface = a.file(path);
    a.set('waterRegionMode', 'box');
    assert.ok(a.api.blockingErrors().some(e => e.includes('VOF水領域')));
    assert.equal(a.file(path), undefined);
    assert.match(a.file('system/setFieldsDict'), /boxToCell/);
    assert.doesNotMatch(a.file('system/setFieldsDict'), /searchableSurfaceToCell/);
    assert.equal(a.d.getElementById('waterBoxControls').hidden, false);
    a.set('waterBoxMin', '(-1 -1 -1)');
    assert.deepEqual(plain(a.api.blockingErrors()), []);
    a.set('waterRegionMode', 'stl');
    assert.equal(a.file(path), surface);
    assert.match(a.file('system/setFieldsDict'), /searchableSurfaceToCell/);
    a.set('solver', 'pimpleFoam');
    assert.equal(a.file(path), undefined);
    assert.equal(a.file('system/setFieldsDict'), undefined);
    a.set('solver', 'interIsoFoam');
    assert.equal(a.file(path), surface);
    assert.deepEqual(plain(a.api.blockingErrors()), []);
  } finally {a.close();}
});

test('clearing or replacing with an invalid STL blocks export and removes the previous water geometry', async () => {
  const a = waterApp();
  try {
    await a.api.importWaterRegionFile(fileFor(a));
    const path = 'constant/triSurface/' + a.api.waterOutputName();
    assert.ok(a.file(path));
    assert.equal(a.d.getElementById('downloadZip').disabled, false);
    a.click('clearWaterRegion');
    assert.equal(a.file(path), undefined);
    assert.equal(a.api.projectSnapshot().auxiliary.water, null);
    assert.equal(a.d.getElementById('downloadZip').disabled, true);
    assert.ok(a.api.blockingErrors().some(e => e.includes('初期水領域専用STL')));
    await a.api.importWaterRegionFile(fileFor(a));
    assert.ok(a.file(path));
    await a.api.importWaterRegionFile(fileFor(a, 'open.stl', cube().slice(1)));
    assert.equal(a.file(path), undefined);
    assert.equal(a.api.projectSnapshot().auxiliary.water, null);
    assert.match(a.d.getElementById('waterRegionStatus').textContent, /開いた辺/);
    assert.equal(a.d.getElementById('downloadZip').disabled, true);
    a.click('generateBtn');
    assert.equal(a.file(path), undefined);
    a.set('waterRegionMode', 'box');
    assert.deepEqual(plain(a.api.blockingErrors()), []);
    assert.equal(a.d.getElementById('downloadZip').disabled, false);
    assert.equal(a.errors.length, 0);
  } finally {a.close();}
});

test('v3 project round-trip preserves dedicated water data, original units, and identical generated surface', async () => {
  const a = waterApp(), b = app();
  try {
    a.set('caseName', 'water_roundtrip');
    a.set('waterRegionScale', '0.001');
    await a.api.importWaterRegionFile(fileFor(a, 'pool_mm.stl', cube([0,0,0],[1500,750,400])));
    const snapshot = plain(a.api.projectSnapshot());
    assert.equal(snapshot.version, 3);
    assert.equal(snapshot.parts.length, 0);
    assert.equal(snapshot.auxiliary.water.fileName, 'pool_mm.stl');
    b.api.restoreProject(snapshot);
    assert.equal(b.d.getElementById('waterRegionMode').value, 'stl');
    assert.equal(b.d.getElementById('waterRegionScale').value, '0.001');
    assert.deepEqual(plain(b.api.projectSnapshot().auxiliary.water), snapshot.auxiliary.water);
    const path = 'constant/triSurface/' + a.api.waterOutputName();
    assert.equal(b.file(path), a.file(path));
    assert.equal(b.file('system/setFieldsDict'), a.file('system/setFieldsDict'));
    assert.equal(b.api.geometryParts.size, 0);
    assert.deepEqual(plain(b.api.blockingErrors()), []);
  } finally {a.close(); b.close();}
});

test('loading a v1 project clears previous water input and restores box defaults', async () => {
  const a = waterApp();
  try {
    a.set('waterRegionScale', '0.001');
    await a.api.importWaterRegionFile(fileFor(a));
    const legacy = plain(a.api.projectSnapshot());
    legacy.version = 1;
    delete legacy.auxiliary;
    for (const key of ['waterRegionMode','waterRegionScale','enableAcceleration','accelerationUnit']) delete legacy.inputs[key];
    a.api.restoreProject(legacy);
    assert.equal(a.d.getElementById('waterRegionMode').value, 'box');
    assert.equal(a.d.getElementById('waterRegionScale').value, '1');
    assert.equal(a.api.projectSnapshot().auxiliary.water, null);
    assert.equal(a.file('constant/triSurface/' + a.api.waterOutputName()), undefined);
    assert.match(a.file('system/setFieldsDict'), /boxToCell/);
    assert.deepEqual(plain(a.api.blockingErrors()), []);
  } finally {a.close();}
});

test('malformed project water data is rejected before existing controls or geometry mutate', async () => {
  const a = waterApp();
  try {
    a.set('caseName', 'retained_water');
    await a.api.importWaterRegionFile(fileFor(a));
    const before = plain(a.api.projectSnapshot());
    const path = 'constant/triSurface/' + a.api.waterOutputName(), exported = a.file(path);
    const bad = structuredClone(before);
    bad.inputs.caseName = 'must_not_be_applied';
    bad.inputs.waterRegionScale = '.001';
    bad.auxiliary.water.faces.pop();
    assert.throws(() => a.api.restoreProject(bad), /閉じた形状/);
    assert.equal(a.d.getElementById('caseName').value, 'retained_water');
    assert.deepEqual(plain(a.api.projectSnapshot()), before);
    assert.equal(a.file(path), exported);
    const invalidCoordinate = structuredClone(before);
    invalidCoordinate.auxiliary.water.faces[0].v[0][0] = null;
    assert.throws(() => a.api.restoreProject(invalidCoordinate), /不正な座標/);
    assert.deepEqual(plain(a.api.projectSnapshot()), before);
    assert.equal(a.errors.length, 0);
  } finally {a.close();}
});
