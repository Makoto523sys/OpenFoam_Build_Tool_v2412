const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const A=require('../src/acceleration.js');

test('input conventions preserve gravity once and explicitly end container excitation',()=>{
  const raw=[{time:0,acceleration:[0,.25,-9.81]},{time:20,acceleration:[0,.25,-9.81]}];
  const options={convention:'gravityIncluded',tail:'zero',tailStep:.01,endTime:50,margin:.01};
  const out=A.prepareSamples(raw,options);
  assert.deepEqual(out[0].acceleration,[0,.25,0]);
  assert.deepEqual(out[1],{time:20,acceleration:[0,.25,0]});
  assert.deepEqual(out[2],{time:20.01,acceleration:[0,0,0]});
  assert.ok(out.at(-1).time>=50.01);
  assert.ok(out.slice(2).every(s=>s.acceleration.every(x=>x===0)));
  assert.deepEqual(raw[0].acceleration,[0,.25,-9.81]);
  assert.deepEqual(A.prepareSamples(raw,{convention:'effective'})[0].acceleration,[0,-.25,0]);
  assert.deepEqual(A.prepareSamples(raw),raw);
  for(const option of [{convention:'bad'},{tail:'bad'},{...options,tailStep:0},{...options,tailStep:1e-8}])assert.throws(()=>A.prepareSamples(raw,option));
});

test('VOF momentum uses the chosen conservative scheme without bounded correction',()=>{
  const a=app();try{
    a.set('includeSnappy',false);a.set('solver','interFoam');
    for(const [selected,expected] of [['bounded Gauss upwind','Gauss upwind'],['bounded Gauss limitedLinearV 1','Gauss limitedLinearV 1'],['bounded Gauss linearUpwind grad(U)','Gauss linearUpwind grad(U)']]){
      a.set('divUScheme',selected);a.click('generateBtn');
      assert.ok(a.file('system/fvSchemes').includes('div(rhoPhi,U)   '+expected+';'));
    }
  }finally{a.close();}
});

test('HTML observation settings export native functions, survive restore and reject nonwall targets',()=>{
  const a=app();try{
    a.set('includeSnappy',false);a.set('solver','interFoam');
    a.click('addMeshPatches');
    const wall=a.api.getPatches().find(p=>p.purpose==='wallNoSlip');assert.ok(wall);
    a.set('foInterfaceHeight',true);a.set('foHeightLocations','(0.1 0.1 0.001)\n(0.9 0.9 0.001)');
    a.set('foHeightDirection','(0 0 -1)');a.set('foHeightInterval','.01');
    a.set('foWallSamples',true);a.set('foWallSamplePatches',wall.name);a.click('generateBtn');
    assert.deepEqual([...a.api.blockingErrors()],[]);
    const text=a.file('system/controlDict');
    assert.match(text,/type interfaceHeight;/);assert.match(text,/direction \(0 0 -1\);/);
    assert.match(text,/fields \(wallShearStress rho alpha.water\);/);
    assert.ok(text.indexOf('type            wallShearStress;')<text.indexOf('wallSamples'));
    const snap=JSON.parse(JSON.stringify(a.api.projectSnapshot()));a.set('foInterfaceHeight',false);a.api.restoreProject(snap);
    assert.equal(a.d.getElementById('foInterfaceHeight').checked,true);
    assert.deepEqual(JSON.parse(a.file('system/caseBuilderChecks.json')).wallSamplePatches,[wall.name]);
    a.set('foWallSamplePatches','missing');assert.match(a.api.blockingErrors().join('\n'),/壁パッチ/);
    a.set('foWallSamplePatches',wall.name);a.set('foHeightDirection','(0 0 0)');assert.match(a.api.blockingErrors().join('\n'),/ゼロ/);
  }finally{a.close();}
});


test('AMR disables moving-mesh Courant evaluation and maps the v2412 alpha flux',()=>{
  const a=app();try{
    a.set('includeSnappy',false);a.set('solver','interFoam');a.click('addMeshPatches');
    a.set('meshMotion','refine');a.click('generateBtn');
    assert.match(a.file('system/fvSolution'),/checkMeshCourantNo no;/);
    assert.match(a.file('constant/dynamicMeshDict'),/\(alphaPhiUn none\)/);
    assert.match(a.file('constant/dynamicMeshDict'),/field alpha.water;/);
    a.set('bmYMinusName','front');a.set('bmYPlusName','back');a.set('bmYMinusType','empty');a.set('bmYPlusType','empty');a.click('addMeshPatches');
    assert.match(a.api.blockingErrors().join('\n'),/empty境界/);
  }finally{a.close();}
});

test('saved native examples reopen in the HTML and preserve the 20-second input / 50-second run',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const name of ['damBreak_stl','damBreak_coarse','damBreak_amr','damBreak_amr_level2','sloshing_csv']){
    const a=app();try{
      a.api.restoreProject(JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/interfoam',name+'.project.json'),'utf8')));
      assert.deepEqual([...a.api.blockingErrors()],[],name);
      assert.match(a.file('system/setFieldsDict'),/searchableSurfaceToCell/);
      assert.doesNotMatch(a.file('system/setFieldsDict'),/boxToCell/);
      if(name==='sloshing_csv'){
        const raw=a.file('constant/acceleration/input.csv').trim().split(/\r?\n/);assert.equal(raw.length,2002);
        assert.match(raw.at(-1),/^20\.00,/);
        const samples=a.api.accelerationSamples();assert.ok(samples.at(-1).time>=50.01);
        assert.deepEqual([...samples[0].acceleration],[0,.25,0]);
        assert.ok(samples.filter(s=>s.time>20).every(s=>s.acceleration.every(x=>x===0)));
        assert.equal(a.d.getElementById('gVec').value,'(0 0 -9.81)');
        assert.match(a.file('system/controlDict'),/endTime\s+50;/);
      }
    }finally{a.close();}
  }
});
