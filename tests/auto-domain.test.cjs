const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const G=require('../src/geometry.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function near(actual,expected){expected.forEach((x,i)=>assert.ok(Math.abs(actual[i]-x)<1e-9,`${actual} != ${expected}`));}
function cube(min,max){
  const points=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(v=>v.map((x,i)=>x?max[i]:min[i]));
  return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]].map(ids=>G.triangle(ids.map(i=>points[i]),'surface'));
}
function file(a,name,faces){
  const bytes=new TextEncoder().encode(G.exportSTL(faces));
  return {name,size:bytes.length,arrayBuffer:async()=>{const b=new a.w.ArrayBuffer(bytes.length);new a.w.Uint8Array(b).set(bytes);return b;}};
}
function outputBounds(a){
  const dict=a.file('system/blockMeshDict'),scale=Number(dict.match(/convertToMeters\s+(\S+);/)[1]);
  const vertices=[...dict.match(/vertices\s*\(([\s\S]*?)\);/)[1].matchAll(/\(([^()]+)\)/g)].map(m=>m[1].trim().split(/\s+/).map(x=>Number(x)*scale));
  return {min:[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))),max:[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])))};
}

test('visible auto-fit action encloses imported STL with unit conversion exactly once and frames the result',async()=>{
  const a=app();try{
    const button=a.d.getElementById('fitDomain');
    assert.equal(button.disabled,true);assert.equal(button.closest('details'),null);assert.ok(button.closest('.background-mesh-controls'));
    await a.api.importGeometryFiles([file(a,'offset.stl',cube([10,20,30],[14,26,32]))]);
    assert.equal(button.disabled,false);
    a.set('locationInMesh','(0.1 0.2 0.3)');a.set('blockCells','30 40 50');
    for(const scale of [1,.001,.01,.0254]){
      a.set('stlScale',String(scale));a.set('convertToMeters','0.01');a.set('includeBlockMesh',false);a.set('showBackgroundMesh',false);a.click('fitDomain');
      const bounds=outputBounds(a);near(bounds.min,[9.2,18.8,29.6].map(x=>x*scale));near(bounds.max,[14.8,27.2,32.4].map(x=>x*scale));
      const exported=G.parseSTL(new TextEncoder().encode(a.api.Geometry.exportSTL(a.api.allFaces(),scale)).buffer);
      for(const p of exported.flatMap(f=>f.v))for(let i=0;i<3;i++)assert.ok(bounds.min[i]<p[i]&&p[i]<bounds.max[i]);
      assert.equal(a.d.getElementById('convertToMeters').value,'1');assert.equal(a.d.getElementById('showBackgroundMesh').checked,true);
      near(a.api.viewer().domain.min,[9.2,18.8,29.6]);near(a.api.viewer().domain.max,[14.8,27.2,32.4]);
      assert.ok(a.api.viewer().domainCorners.every(p=>a.api.viewer().project(p).every(x=>Math.abs(x)<1)));
      assert.equal(a.d.getElementById('locationInMesh').value,'(0.1 0.2 0.3)');assert.match(a.file('system/blockMeshDict'),/\(30 40 50\)/);
    }
    assert.equal(a.api.getPatches().length,0);assert.equal(a.d.getElementById('domainFitStatus').hidden,false);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('auto-fit includes hidden and unselected mesh STLs but excludes separate initial-water geometry',async()=>{
  const a=app();try{
    await a.api.importGeometryFiles([file(a,'near.stl',cube([0,0,0],[1,1,1])),file(a,'far.stl',cube([10,-5,2],[12,-3,4]))]);
    a.set('selectionMode','component');a.api.viewer().onPick(a.api.geometryParts.get('far.stl').faces[0],false);a.click('hideSelection');
    a.api.viewer().onPick(a.api.geometryParts.get('near.stl').faces[0],false);
    a.set('visualPatchName','customWall');a.click('assignVisualPatch');const patches=plain(a.api.getPatches());
    a.set('solver','interFoam');await a.api.importWaterRegionFile(file(a,'initial.stl',cube([100,100,100],[101,101,101])));
    a.set('domainMarginPercent','10');a.click('fitDomain');
    const bounds=outputBounds(a);near(bounds.min,[-1.2,-5.6,-.4]);near(bounds.max,[13.2,1.6,4.4]);
    assert.ok(a.api.geometryParts.get('far.stl').faces.every(f=>f.hidden));assert.deepEqual(plain(a.api.getPatches()),patches);
    assert.match(a.d.getElementById('domainFitStatus').textContent,/2 個/);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('flat geometry gets positive background thickness and padding edits apply only on demand',async()=>{
  const a=app();try{
    await a.api.importGeometryFiles([file(a,'flat.stl',[G.triangle([[0,0,5],[10,0,5],[0,2,5]])])]);
    a.click('fitDomain');let b=outputBounds(a);near(b.min,[-2,-.4,4.8]);near(b.max,[12,2.4,5.2]);
    const before=a.file('system/blockMeshDict');a.set('domainMarginPercent','5');assert.equal(a.file('system/blockMeshDict'),before);
    a.click('fitDomain');b=outputBounds(a);near(b.min,[-.5,-.1,4.95]);near(b.max,[10.5,2.1,5.05]);
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('invalid margins and units never overwrite existing bounds or the retained fluid point',async()=>{
  const a=app();try{
    await a.api.importGeometryFiles([file(a,'shape.stl',cube([0,0,0],[1000,1000,1000]))]);
    a.set('boxMin','(-3 -2 -1)');a.set('boxMax','(3 2 1)');a.set('convertToMeters','.01');a.set('includeBlockMesh',false);a.set('showBackgroundMesh',false);a.set('locationInMesh','(.01 .02 .03)');
    const state=()=>['boxMin','boxMax','convertToMeters','includeBlockMesh','showBackgroundMesh','locationInMesh'].map(id=>{const el=a.d.getElementById(id);return el.type==='checkbox'?el.checked:el.value;});
    const before=state();
    for(const value of ['', '0','-5','1e999','1e308']){
      a.set('domainMarginPercent',value);a.click('fitDomain');assert.deepEqual(state(),before);assert.equal(a.d.getElementById('domainFitStatus').hidden,false);assert.match(a.d.getElementById('domainFitStatus').className,/danger/);
    }
    a.set('domainMarginPercent','20');a.set('stlScale','');a.click('fitDomain');assert.deepEqual(state(),before);
    a.set('stlScale','1');a.click('fitDomain');assert.notDeepEqual(state(),before);assert.match(a.d.getElementById('domainFitStatus').className,/ok/);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('projects preserve margin and manual bounds; older projects use the default margin without refitting',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('domainMarginPercent','12.5');a.set('boxMin','(-7 -6 -5)');
    const saved=plain(a.api.projectSnapshot());a.set('domainMarginPercent','35');a.click('fitDomain');a.api.restoreProject(saved);
    assert.equal(a.d.getElementById('domainMarginPercent').value,'12.5');near(outputBounds(a).min,[-7,-6,-5]);
    delete saved.inputs.domainMarginPercent;
    for(const version of [1,2,3]){
      a.set('domainMarginPercent','35');a.api.restoreProject({...saved,version});assert.equal(a.d.getElementById('domainMarginPercent').value,'20');near(outputBounds(a).min,[-7,-6,-5]);
    }
    a.click('resetGeometries');assert.equal(a.d.getElementById('fitDomain').disabled,true);assert.equal(a.errors.length,0);
  }finally{a.close();}
});
