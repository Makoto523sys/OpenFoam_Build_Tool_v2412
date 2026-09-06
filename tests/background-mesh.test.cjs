const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function near(actual,expected){expected.forEach((x,i)=>assert.ok(Math.abs(actual[i]-x)<1e-9,`${actual} != ${expected}`));}

test('background box is enabled and framed before importing STL, with a visible control and settings link',()=>{
  const a=app();try{
    const control=a.d.getElementById('showBackgroundMesh');assert.equal(control.checked,true);
    assert.ok(control.closest('#workbench'));assert.equal(control.closest('details'),null);
    assert.ok(a.d.querySelector('a[href="#backgroundMeshSettings"]'));assert.ok(a.d.getElementById('backgroundMeshSettings'));
    const v=a.api.viewer();assert.deepEqual(plain(v.domain),{min:[-1,-.5,-.5],max:[1,.5,.5]});
    assert.ok(v.domainCorners.every(p=>v.project(p).every(x=>Math.abs(x)<1)));
    assert.match(a.d.getElementById('backgroundMeshStatus').textContent,/背景領域 \[m\]: X -1 ～ 1/);
    assert.equal(a.api.allFaces().length,0);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('display bounds match blockMeshDict after block scaling and all STL unit conversions',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('boxMin','(-200 10 -80)');a.set('boxMax','(400 30 60)');a.set('convertToMeters','0.001');a.set('locationInMesh','(0.05 0.02 -0.001)');
    for(const scale of [1,.001,.01,.0254]){
      a.set('stlScale',String(scale));
      const dict=a.file('system/blockMeshDict'),meters=Number(dict.match(/convertToMeters\s+(\S+);/)[1]);
      const vertices=[...dict.match(/vertices\s*\(([\s\S]*?)\);/)[1].matchAll(/\(([^()]+)\)/g)].map(m=>m[1].trim().split(/\s+/).map(x=>Number(x)*meters));
      const min=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))),max=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
      near(a.api.viewer().domain.min,min.map(x=>x/scale));near(a.api.viewer().domain.max,max.map(x=>x/scale));
      near(a.api.viewer().point,[.05/scale,.02/scale,-.001/scale]);
    }
    const point=plain(a.api.viewer().point);a.set('convertToMeters','0.01');
    assert.deepEqual(plain(a.api.viewer().point),point,'block scale never moves the locationInMesh point');
    near(a.api.viewer().domain.min,[-2/.0254,.1/.0254,-.8/.0254]);
  }finally{a.close();}
});

test('display toggle, invalid coordinates and disabled blockMesh remove stale outlines without changing STL or solver data',()=>{
  const a=app();try{
    a.click('demoGeometry');const v=a.api.viewer(),stl=a.api.Geometry.exportSTL(a.api.allFaces()),dict=a.file('system/blockMeshDict'),snappy=a.file('system/snappyHexMeshDict');
    a.set('showBackgroundMesh',false);assert.equal(v.domain,null);assert.equal(a.file('system/blockMeshDict'),dict);assert.equal(a.file('system/snappyHexMeshDict'),snappy);
    a.set('showBackgroundMesh',true);assert.ok(v.domain);
    for(const value of ['', '(3 3 3)', '(1 NaN 0)', '(1e999 0 0)']){a.set('boxMin',value);assert.equal(v.domain,null);assert.equal(a.d.getElementById('backgroundMeshLegend').hidden,true);}
    a.set('boxMin','(-1 -1 -1)');assert.ok(v.domain);
    for(const value of ['0','-1','']){a.set('convertToMeters',value);assert.equal(v.domain,null);}
    a.set('convertToMeters','1');a.set('stlScale','');assert.equal(v.domain,null);a.set('stlScale','1');
    a.set('includeBlockMesh',false);assert.equal(v.domain,null);assert.equal(a.file('system/blockMeshDict'),undefined);
    a.set('includeBlockMesh',true);a.set('includeSnappy',false);assert.ok(v.domain,'standalone blockMesh still has an outline');
    a.api.allFaces().forEach(f=>f.selected=true);a.click('hideSelection');assert.ok(v.domain);assert.equal(a.api.allFaces().length,24);
    assert.equal(a.api.Geometry.exportSTL(a.api.allFaces()),stl);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('auto-fit domain and project restoration update the outline and retain display preferences',()=>{
  const a=app();try{
    a.click('demoGeometry');a.click('fitDomain');near(a.api.viewer().domain.min,[-1.4,-1.4,-1.4]);near(a.api.viewer().domain.max,[1.4,1.4,1.4]);
    a.set('boxMax','(99 3 4)');a.set('stlScale','0.001');
    const saved=plain(a.api.projectSnapshot());
    a.set('showBackgroundMesh',false);const hidden=plain(a.api.projectSnapshot());
    a.api.restoreProject(saved);assert.ok(a.api.viewer().domain);near(a.api.viewer().domain.max,[99000,3000,4000]);
    assert.ok(a.api.viewer().domainCorners.every(p=>a.api.viewer().project(p).every(x=>Math.abs(x)<1)));
    a.api.restoreProject(hidden);assert.equal(a.api.viewer().domain,null);assert.equal(a.d.getElementById('showBackgroundMesh').checked,false);
    delete saved.inputs.showBackgroundMesh;
    for(const version of [1,2,3]){a.set('showBackgroundMesh',false);a.api.restoreProject({...saved,version});assert.equal(a.d.getElementById('showBackgroundMesh').checked,true);assert.ok(a.api.viewer().domain);}
  }finally{a.close();}
});
