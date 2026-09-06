const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const values=v=>Array.from(v);
function closeVector(actual,expected,tolerance=1e-9){expected.forEach((x,i)=>assert.ok(Math.abs(actual[i]-x)<tolerance,`${actual} != ${expected}`));}

test('one always-visible locationInMesh input controls one point and the exported dictionary',()=>{
  const a=app();try{
    const input=a.d.getElementById('locationInMesh');
    assert.equal(a.d.querySelectorAll('#locationInMesh').length,1);
    assert.ok(input.closest('#workbench'));assert.equal(input.closest('details'),null);
    for(let el=input;el;el=el.parentElement){assert.equal(el.hidden,false);assert.notEqual(a.w.getComputedStyle(el).display,'none');}
    assert.equal(a.api.viewer().pointViewState(),'empty');
    a.click('demoGeometry');
    const before=a.api.Geometry.exportSTL(a.api.allFaces());
    a.set('locationInMesh','(0.25 -0.125 0)');
    assert.deepEqual(values(a.api.viewer().point),[.25,-.125,0]);
    assert.match(a.file('system/snappyHexMeshDict'),/locationInMesh \(0.25 -0.125 0\);/);
    a.set('locationInMesh','(-0.5 0 2.5e-1)');
    assert.deepEqual(values(a.api.viewer().point),[-.5,0,.25]);
    assert.match(a.file('system/snappyHexMeshDict'),/locationInMesh \(-0.5 0 2.5e-1\);/);
    assert.equal(a.api.allFaces().length,24);
    assert.equal(a.api.Geometry.exportSTL(a.api.allFaces()),before,'display point never becomes STL geometry');
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('point coordinates remain metres across all STL units and blockMesh scaling',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('includeBlockMesh',false);
    a.set('locationInMesh','(0.0254 -0.0127 0)');
    for(const scale of [1,.001,.01,.0254]){
      a.set('stlScale',String(scale));
      closeVector(a.api.viewer().point,[.0254/scale,-.0127/scale,0]);
      a.set('convertToMeters','0.001');
      closeVector(a.api.viewer().point,[.0254/scale,-.0127/scale,0]);
      assert.match(a.file('system/snappyHexMeshDict'),/locationInMesh \(0.0254 -0.0127 0\);/);
    }
    a.set('stlScale','0.001');a.set('locationInMesh','(0.0005 0 0)');
    closeVector(a.api.viewer().point,[.5,0,0]);
    const output=a.api.Geometry.parseSTL(new TextEncoder().encode(a.api.Geometry.exportSTL(a.api.allFaces(),.001)).buffer);
    assert.equal(a.api.Geometry.bounds(output).max[0],.001);
  }finally{a.close();}
});

test('invalid edits immediately remove the old point and valid input restores it',()=>{
  const a=app();try{
    a.click('demoGeometry');
    for(const value of ['', '(1 2)', '(1 NaN 3)', '(1e999 0 0)', '(1, 2, 3)']){
      a.set('locationInMesh',value);assert.equal(a.api.viewer().point,null);
      assert.equal(a.d.getElementById('fluidPointLegend').hidden,true);
      assert.equal(a.d.getElementById('locationInMesh').getAttribute('aria-invalid'),'true');
      assert.ok(a.api.blockingErrors().some(e=>e.includes('locationInMesh')));
    }
    a.set('locationInMesh','(1e-3 -2.5 0)');
    assert.deepEqual(values(a.api.viewer().point),[.001,-2.5,0]);
    assert.equal(a.d.getElementById('locationInMesh').getAttribute('aria-invalid'),'false');
    a.set('stlScale','');assert.equal(a.api.viewer().point,null);
    a.set('stlScale','1');assert.deepEqual(values(a.api.viewer().point),[.001,-2.5,0]);
  }finally{a.close();}
});

test('domain and selected-face actions update the same marker without hiding it with selected faces',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('locationInMesh','(0.4 0.2 -0.1)');a.click('fitDomain');
    closeVector(a.api.viewer().point,[.4,.2,-.1]);
    const f=a.api.allFaces()[0];f.selected=true;a.set('fluidOffset','0.2');
    const expected=[0,1,2].map(i=>(f.v[0][i]+f.v[1][i]+f.v[2][i])/3+.2*f.n[i]);
    // The existing face-offset action formats its result to seven significant digits.
    a.click('setFluidPoint');closeVector(a.api.viewer().point,expected,1e-7);
    a.click('hideSelection');closeVector(a.api.viewer().point,expected,1e-7);assert.equal(f.hidden,true);
    a.click('showAllFaces');closeVector(a.api.viewer().point,expected,1e-7);assert.equal(f.hidden,false);
    a.click('resetGeometries');assert.equal(a.api.viewer().pointViewState(),'empty');
  }finally{a.close();}
});

test('restoring a project fits the restored scaled point, including older project versions',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('stlScale','0.001');a.set('locationInMesh','(4 -2 0)');
    const saved=JSON.parse(JSON.stringify(a.api.projectSnapshot()));
    for(const version of [1,2,3]){
      a.set('stlScale','1');a.set('locationInMesh','(0 0 0)');
      a.api.restoreProject({...saved,version});
      const viewer=a.api.viewer();assert.deepEqual(values(viewer.point),[4000,-2000,0]);
      assert.ok(viewer.project(viewer.point).every(x=>Math.abs(x)<1),'restored point is framed before drawing');
      assert.match(a.file('system/snappyHexMeshDict'),/locationInMesh \(4 -2 0\);/);
      assert.equal(a.api.allFaces().length,24);
    }
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});
