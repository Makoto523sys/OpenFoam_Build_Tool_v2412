const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function empty(a){assert.equal(a.d.querySelectorAll('#patchTable tbody tr').length,0);assert.equal(a.d.getElementById('patchEmptyStatus').hidden,false);assert.match(a.file('0/U'),/boundaryField\s*\{\s*\}/);}

test('patch table starts empty and stays empty through ordinary edits, presets and STL import',async()=>{
  const a=app();try{
    empty(a);assert.match(a.d.title,/v8\.4$/);
    for(const id of ['presetRobust','presetAccurate','presetVOF','presetLES','presetHeat','generateBtn','guessFields']){a.click(id);empty(a);}
    a.set('solver','pimpleFoam');a.set('includeBlockMesh',false);a.set('includeBlockMesh',true);a.set('bmXMinusName','customInlet');empty(a);
    const bytes=new TextEncoder().encode(a.api.Geometry.exportSTL([a.api.Geometry.triangle([[0,0,0],[1,0,0],[0,1,0]])]));
    await a.api.importGeometryFiles([{name:'wall.stl',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]);empty(a);
    assert.match(a.d.getElementById('validationBox').textContent,/境界パッチが未登録/);
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('manual additions use unique names and survive editing, deletion and regeneration',()=>{
  const a=app();try{
    a.click('addPatch');assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['patch1']);
    const name=a.d.querySelector('#patchTable [data-k="name"]');name.value='myWall';name.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['myWall']);
    a.click('addPatch');a.click('addPatch');assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['myWall','patch1','patch2']);
    a.d.querySelectorAll('#patchTable [data-remove]')[1].click();a.click('addPatch');
    assert.equal(new Set(a.api.getPatches().map(p=>p.name)).size,3);
    a.set('endTime','2');assert.equal(a.api.getPatches().length,3);assert.match(a.file('0/U'),/myWall\s*\{/);
    a.click('resetPatches');empty(a);a.click('generateBtn');empty(a);
  }finally{a.close();}
});

test('mesh patches are added on request without overwriting edits; clearing or deleting never silently repopulates',()=>{
  const a=app();try{
    a.click('demoGeometry');a.set('meshMotion','ami');empty(a);
    a.click('addMeshPatches');const names=plain(a.api.getPatches().map(p=>p.name));assert.ok(names.includes('inlet'));assert.ok(names.includes('nozzle_0'));assert.ok(names.includes('rotorAMI'));
    assert.match(a.file('0/U'),/rotorAMI\s*\{\s*type\s+cyclicAMI/);
    const row=[...a.d.querySelectorAll('#patchTable tbody tr')].find(tr=>tr.querySelector('[data-k="name"]').value==='inlet');
    const input=row.querySelector('[data-k="U"]');input.value='(7 0 0)';input.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    a.click('addMeshPatches');assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),names);assert.equal(a.api.getPatches().find(p=>p.name==='inlet').U,'(7 0 0)');
    row.querySelector('[data-remove]').click();a.click('generateBtn');assert.ok(!a.api.getPatches().some(p=>p.name==='inlet'));
    a.click('resetPatches');a.set('locationInMesh','(0.6 0 0)');a.set('stlScale','0.001');empty(a);
    a.click('bmSyncPatches');assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['inlet','outlet','walls']);
  }finally{a.close();}
});

test('empty and populated projects preserve their exact patch lists on restore',()=>{
  const a=app();try{
    a.click('demoGeometry');const saved=plain(a.api.projectSnapshot());
    a.click('addMeshPatches');const populated=plain(a.api.projectSnapshot());
    for(const version of [1,2,3]){a.api.restoreProject({...saved,version});empty(a);a.api.restoreProject({...populated,version});assert.deepEqual(plain(a.api.getPatches()),populated.patches);}
    a.click('resetPatches');const selected=a.api.allFaces().find(f=>f.file==='nozzle.stl');selected.selected=true;
    a.set('visualPatchName','waterJet');a.click('generateBtn');a.click('assignVisualPatch');
    assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['waterJet']);assert.match(a.file('0/U'),/waterJet\s*\{/);
  }finally{a.close();}
});
