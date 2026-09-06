const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
async function importSurface(a,name='container.stl'){
  const bytes=new TextEncoder().encode(a.api.Geometry.exportSTL([a.api.Geometry.triangle([[0,0,0],[2,0,0],[0,3,0]])]));
  await a.api.importGeometryFiles([{name,size:bytes.length,arrayBuffer:async()=>bytes.buffer}]);
  const face=a.api.allFaces().at(-1);
  // Use the viewer's actual selection callback, then the DOM assignment button.
  a.api.viewer().onPick(face,false);
  assert.equal(a.d.getElementById('assignVisualPatch').disabled,false);
  return face;
}
function assign(a,name){a.set('visualPatchName',name);a.click('assignVisualPatch');}
function result(a){return a.d.getElementById('visualPatchStatus');}

test('STL selection and assignment adds the entered conditions to section 4 and exported fields',async()=>{
  const a=app();try{
    a.set('solver','interFoam');const face=await importSurface(a);
    a.set('visualPurpose','volumetricFlowRateInlet');a.set('visualU','(0 0 2)');a.set('visualQ','0.006');
    a.set('visualMdot','6');a.set('visualP','12');a.set('visualT','303.15');a.set('visualAlpha','0.8');
    assert.equal(a.api.getPatches().length,0);assign(a,'waterJet');
    assert.deepEqual(plain(a.api.getPatches()),[{name:'waterJet',purpose:'volumetricFlowRateInlet',U:'(0 0 2)',normal:'(0 0 1)',area:'3',Q:'0.006',mdot:'6',p:'12',T:'303.15',alpha:'0.8'}]);
    assert.equal(face.patch,'waterJet');assert.match(a.file('system/snappyHexMeshDict'),/waterJet \{ name waterJet;/);
    assert.match(a.file('0/U'),/waterJet\s*\{[^}]*flowRateInletVelocity[^}]*0.006/s);
    assert.match(a.file('0/alpha.water'),/waterJet\s*\{[^}]*0.8/s);
    assert.equal(result(a).hidden,false);assert.match(result(a).textContent,/waterJet.*第4欄.*追加/);
    const link=a.d.getElementById('assignedPatchLink');assert.equal(link.hidden,false);
    assert.equal(a.d.querySelector(link.getAttribute('href')).querySelector('h2').textContent,'4. 境界パッチと0ディレクトリ');
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('an assigned STL patch survives disabled snappy output, regeneration and project restoration',async()=>{
  const a=app();try{
    await importSurface(a);a.set('includeSnappy',false);assign(a,'waterJet');
    assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['waterJet']);
    for(const enabled of [true,false]){a.set('includeSnappy',enabled);a.click('generateBtn');assert.equal(a.api.getPatches()[0]?.name,'waterJet');}
    a.api.restoreProject(plain(a.api.projectSnapshot()));assert.equal(a.api.getPatches()[0]?.name,'waterJet');
    a.d.querySelector('#geometryTable [data-remove-geom]').click();assert.equal(a.api.getPatches().length,0);
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('reselection loads all registered values and assignment updates one row; deleted rows return only on assignment',async()=>{
  const a=app();try{
    const face=await importSurface(a);a.set('visualPurpose','velocityInlet');a.set('visualU','(0 2 0)');a.set('visualQ','0.005');assign(a,'waterJet');
    a.set('visualU','(9 9 9)');a.set('visualQ','9');
    [...a.d.querySelectorAll('#partList button')].find(b=>b.textContent==='waterJet').click();
    assert.equal(a.d.getElementById('visualU').value,'(0 2 0)');assert.equal(a.d.getElementById('visualQ').value,'0.005');
    a.set('visualU','(0 4 0)');a.click('assignVisualPatch');assert.equal(a.api.getPatches().length,1);assert.equal(a.api.getPatches()[0].U,'(0 4 0)');
    assert.match(result(a).textContent,/更新/);
    a.api.viewer().onPick(face,false);assert.equal(a.d.getElementById('visualU').value,'(0 4 0)');
    a.d.querySelector('#patchTable [data-remove]').click();a.click('generateBtn');assert.equal(a.api.getPatches().length,0);
    a.click('assignVisualPatch');assert.equal(a.api.getPatches().length,1);
    assign(a,'renamedJet');assert.deepEqual(plain(a.api.getPatches().map(p=>p.name)),['renamedJet']);
    assert.doesNotMatch(a.file('0/U'),/\n\s*waterJet\s*\{/);assert.equal(face.patch,'renamedJet');
  }finally{a.close();}
});

test('invalid and conflicting patch names explain the failure beside the assignment button without changing the table',async()=>{
  const a=app();try{
    const face=await importSurface(a),original=face.patch;
    for(const name of ['inlet','outlet','walls','rotorAMI','1invalid']){
      assign(a,name);assert.equal(a.api.getPatches().length,0);assert.equal(face.patch,original);
      assert.equal(result(a).hidden,false);assert.ok(result(a).classList.contains('danger'));
      assert.equal(a.d.getElementById('assignVisualPatch').nextElementSibling,result(a));
      assert.equal(a.d.getElementById('assignedPatchLink').hidden,true);
    }
    assign(a,'waterJet');assert.equal(a.api.getPatches().length,1);assert.ok(result(a).classList.contains('ok'));
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});
