const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const G=require('../src/geometry.js');
const plain=x=>JSON.parse(JSON.stringify(x));
const row=(a,name)=>[...a.d.querySelectorAll('#patchTable tbody tr')].find(r=>r.querySelector('[data-k="name"]').value===name);
function patch(a,name,key,value){const el=row(a,name).querySelector(`[data-k="${key}"]`);el.value=value;el.dispatchEvent(new a.w.Event('input',{bubbles:true}));}
function quad(v,name){return [G.triangle([v[0],v[1],v[2]],name),G.triangle([v[0],v[2],v[3]],name)];}
async function channel(a){
  a.set('turbulenceType','RAS');a.set('rasModel','kOmegaSST');
  const parts={
    inlet:quad([[0,0,0],[0,0,1],[0,5,1],[0,5,0]],'inlet'),
    outlet:quad([[30,0,0],[30,5,0],[30,5,1],[30,0,1]],'outlet'),
    walls:[...quad([[0,0,0],[30,0,0],[30,0,1],[0,0,1]],'walls'),...quad([[0,5,0],[0,5,1],[30,5,1],[30,5,0]],'walls')],
    symmery:[...quad([[0,0,0],[0,5,0],[30,5,0],[30,0,0]],'symmery'),...quad([[0,0,1],[30,0,1],[30,5,1],[0,5,1]],'symmery')]
  };
  await a.api.importGeometryFiles(Object.entries(parts).map(([name,faces])=>{const bytes=new TextEncoder().encode(G.exportSTL(faces));return {name:name+'.stl',size:bytes.length,arrayBuffer:async()=>bytes.buffer};}));
  a.click('fitDomain');a.set('locationInMesh','(1 1 0.5)');a.click('addMeshPatches');patch(a,'inlet_inlet','purpose','velocityInlet');patch(a,'inlet_inlet','U','(10 0 0)');
}

test('PIMPLE residuals use per-field dictionaries; SIMPLE stays scalar and PISO omits outer residual control',()=>{
  const a=app();try{
    for(const [solver,p] of [['pimpleFoam','p'],['interFoam','p_rgh'],['buoyantBoussinesqPimpleFoam','p_rgh'],['rhoPimpleFoam','p']]){
      a.set('solver',solver);const f=a.file('system/fvSolution');assert.match(f,new RegExp(p+' \\{ tolerance 1e-4; relTol 0; \\}'));assert.match(f,/U \{ tolerance 1e-5; relTol 0; \}/);
    }
    a.set('solver','simpleFoam');assert.match(a.file('system/fvSolution'),/residualControl\s*\{\s*p\s+1e-4;/);assert.doesNotMatch(a.file('system/fvSolution'),/p \{ tolerance/);
    a.set('solver','icoFoam');assert.doesNotMatch(a.file('system/fvSolution'),/residualControl/);
    a.set('solver','pimpleFoam');a.set('nOuter','1');assert.match(a.d.getElementById('algorithmHelp').textContent,/上限1/);
    assert.match(a.d.getElementById('algorithmHelp').textContent,/解析時間全体/);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('solverInfo follows solved fields and rejects invalid manual fields without silently changing them',()=>{
  const a=app();try{
    a.set('turbulenceType','RAS');a.set('rasModel','kOmegaSST');
    assert.match(a.file('system/controlDict'),/type\s+solverInfo;/);assert.match(a.file('system/controlDict'),/fields\s+\(p U k omega\)/);assert.doesNotMatch(a.file('system/controlDict'),/type\s+residuals;|InfoSwitches/);assert.equal(a.d.getElementById('infoLevel'),null);
    a.set('rasModel','kEpsilon');assert.equal(a.d.getElementById('foResidualFields').value,'p U k epsilon');
    a.set('solver','interFoam');assert.equal(a.d.getElementById('foResidualFields').value,'p_rgh U k epsilon');
    a.set('solver','icoFoam');assert.equal(a.d.getElementById('foResidualFields').value,'p U');
    a.set('foResidualMode','manual');a.set('foResidualFields','p U omega');assert.ok(a.api.blockingErrors().some(e=>e.includes('solverInfo: omega')));
    a.set('solver','pimpleFoam');assert.equal(a.d.getElementById('foResidualFields').value,'p U omega');
    a.set('foResidualMode','auto');a.set('solver','rhoPimpleFoam');assert.match(a.d.getElementById('foResidualFields').value,/\bh\b/);assert.doesNotMatch(a.d.getElementById('foResidualFields').value,/\bT\b/);
  }finally{a.close();}
});

test('reported STL outlet setup warns about disappearing background pressure; selecting pressure outlet fixes all relevant fields',async()=>{
  const a=app();try{
    await channel(a);patch(a,'outlet_outlet','purpose','outletZeroGradient');
    assert.match(a.file('0/p'),/outlet_outlet\s*\{\s*type\s+zeroGradient;/);
    assert.match(a.d.getElementById('boundarySetupStatus').textContent,/背景側/);
    assert.match(row(a,'outlet').querySelector('[data-patch-source]').textContent,/背景/);
    assert.match(row(a,'outlet_outlet').querySelector('[data-patch-source]').textContent,/STL outlet.stl/);
    assert.equal(a.api.getPatches().find(p=>p.name==='symmery_symmery').purpose,'wallNoSlip','names never infer symmetry');
    patch(a,'outlet_outlet','purpose','pressureOutlet');
    assert.match(a.file('0/p'),/outlet_outlet\s*\{\s*type\s+fixedValue;\s*value\s+uniform 0;/);
    assert.match(a.file('0/U'),/outlet_outlet\s*\{\s*type\s+pressureInletOutletVelocity;/);
    for(const f of ['k','omega'])assert.match(a.file('0/'+f),/outlet_outlet\s*\{\s*type inletOutlet;\s*inletValue uniform/);
    assert.doesNotMatch(a.d.getElementById('boundarySetupStatus').textContent,/背景側/);
    assert.match(a.d.getElementById('physicalScaleSummary').textContent,/30 × 5 × 1/);assert.match(a.d.getElementById('physicalScaleSummary').textContent,/50 m³\/s/);
    a.set('stlScale','0.001');assert.match(a.d.getElementById('physicalScaleSummary').textContent,/0.03 × 0.005 × 0.001/);assert.equal(a.d.getElementById('initialU').value,'(0 0 0)');
  }finally{a.close();}
});

test('zero-gradient outlets remain available for compatible initialization or a separate pressure condition',()=>{
  const a=app();try{
    a.set('includeSnappy',false);a.click('addMeshPatches');patch(a,'outlet','purpose','outletZeroGradient');
    assert.ok(a.api.blockingErrors().some(e=>e.includes('非ゼロの流入')));
    a.set('initialU','(1 0 0)');assert.ok(!a.api.blockingErrors().some(e=>e.includes('非ゼロの流入')));assert.match(a.file('0/U'),/internalField\s+uniform \(1 0 0\)/);
    a.set('initialU','(0 0 0)');patch(a,'inlet','purpose','volumetricFlowRateInlet');patch(a,'inlet','Q','2');patch(a,'outlet','purpose','volumetricFlowRateOutlet');patch(a,'outlet','Q','2');assert.ok(!a.api.blockingErrors().some(e=>e.includes('非ゼロの流入')));
    a.set('foSFVMode','manual');a.set('foSFVPatch','outlet');a.set('bmXPlusName','exitFace');assert.ok(row(a,'exitFace'));assert.equal(a.d.getElementById('foSFVPatch').value,'exitFace');
  }finally{a.close();}
});

test('automatic inlet/outlet monitoring, candidate selection and full patch renames stay connected',async()=>{
  const a=app();try{
    await channel(a);patch(a,'outlet_outlet','purpose','pressureOutlet');
    let config=JSON.parse(a.file('system/caseBuilderChecks.json'));assert.ok(config.flow.names.includes('inlet_inlet'));assert.ok(config.flow.names.includes('outlet_outlet'));assert.equal(config.flow.mode,'auto');
    assert.match(a.file('system/flowMonitors'),/patchFlux_inlet_inlet/);assert.match(a.file('system/flowMonitors'),/patchFlux_outlet_outlet/);assert.match(a.file('system/flowMonitors'),/flowBalance/);
    a.set('foSFVMode','manual');a.set('foSFVPatch','outlet_outlet');a.set('foPatchCandidate','inlet_inlet');a.click('addFluxPatch');
    patch(a,'outlet_outlet','name','drain');assert.equal(a.d.getElementById('foSFVPatch').value,'drain inlet_inlet');assert.match(a.file('system/flowMonitors'),/patchFlux_drain/);assert.doesNotMatch(a.file('system/flowMonitors'),/outlet_outlet/);
    a.set('foSFVPatch','does_not_exist');assert.ok(a.api.blockingErrors().some(e=>e.includes('流量監視: does_not_exist')));
    a.set('foSFVPatch','drain');a.set('foSFVField','rhoPhi');assert.ok(a.api.blockingErrors().some(e=>e.includes('rhoPhi')));
    a.set('solver','interFoam');assert.ok(!a.api.blockingErrors().some(e=>e.includes('rhoPhi')));
    config=JSON.parse(a.file('system/caseBuilderChecks.json'));assert.equal(config.flow.field,'rhoPhi');assert.ok(config.patches.find(p=>p.name==='drain').sources.some(s=>s.kind==='stl'));
  }finally{a.close();}
});

test('opposite STL normals can use symmetry but not symmetryPlane; empty also checks mesh requirements',async()=>{
  const a=app();try{
    await channel(a);patch(a,'symmery_symmery','purpose','symmetryPlane');assert.ok(a.api.blockingErrors().some(e=>e.includes('symmery_symmery: symmetryPlane')));
    patch(a,'symmery_symmery','purpose','symmetry');assert.ok(!a.api.blockingErrors().some(e=>e.includes('symmery_symmery: symmetryPlane')));
    for(const f of ['U','p','k','omega','nut'])assert.match(a.file('0/'+f),/symmery_symmery\s*\{\s*type\s+symmetry;/);
    assert.match(a.file('system/snappyHexMeshDict'),/symmery_symmery \{ level[^\n]*type symmetry;/);
    patch(a,'inlet_inlet','purpose','symmetryPlane');assert.ok(!a.api.blockingErrors().some(e=>e.includes('inlet_inlet: symmetryPlane')));
    a.set('includeSnappy',false);a.click('bmPreset2DXY');a.click('addMeshPatches');a.set('blockCells','10 10 2');assert.ok(a.api.blockingErrors().some(e=>e.includes('emptyの厚み方向 Z')));
  }finally{a.close();}
});

test('layer validation distinguishes disabled layers, relative thickness, total thickness and absolute metres',async()=>{
  const a=app();try{
    await channel(a);a.set('finalLayerThickness','0.001');assert.ok(!a.api.blockingErrors().some(e=>e.includes('総層厚')));
    a.set('snappyLayers',true);assert.ok(a.api.blockingErrors().some(e=>e.includes('層数が1以上')));
    const layers=[...a.d.querySelectorAll('#geometryTable tbody tr')].find(r=>r.querySelector('[data-g="file"]').value==='walls.stl').querySelector('[data-g="layers"]');layers.value='3';layers.dispatchEvent(new a.w.Event('input',{bubbles:true}));
    assert.ok(a.api.blockingErrors().some(e=>e.includes('総層厚')));a.set('layerMinThickness','0.0001');assert.ok(!a.api.blockingErrors().some(e=>e.includes('総層厚')));
    a.set('layerRelativeSizes','false');assert.match(a.file('system/snappyHexMeshDict'),/relativeSizes false;/);assert.match(a.file('system/snappyHexMeshDict'),/minThickness 0.0001;/);assert.match(a.d.getElementById('layerSummary').textContent,/厚さ単位: m/);
    a.set('layerExpansionRatio','1');assert.match(a.d.getElementById('layerSummary').textContent,/総厚さ 0.003/);
    a.set('layerExpansionRatio','0');assert.ok(a.api.blockingErrors().some(e=>e.includes('layerExpansionRatio')));
    a.set('foYPlus',true);assert.match(a.file('system/controlDict'),/type\s+yPlus;/);assert.doesNotMatch(a.file('system/snappyHexMeshDict'),/relaxed \{ maxNonOrtho 75/);
  }finally{a.close();}
});

test('saved projects retain monitoring choices; legacy manual references remain explicit and stale residual defaults migrate',()=>{
  const a=app();try{
    a.set('turbulenceType','RAS');a.set('rasModel','kOmegaSST');
    a.set('includeSnappy',false);a.click('addMeshPatches');a.set('foSFVMode','manual');a.set('foSFVPatch','inlet outlet');a.set('initialU','(2 0 0)');
    const saved=plain(a.api.projectSnapshot());a.set('initialU','(9 0 0)');a.api.restoreProject(saved);assert.equal(a.d.getElementById('initialU').value,'(2 0 0)');assert.equal(a.d.getElementById('foSFVPatch').value,'inlet outlet');
    const legacy=plain(saved);delete legacy.inputs.foResidualMode;delete legacy.inputs.foSFVMode;delete legacy.inputs.initialU;legacy.inputs.foResidualFields='p p_rgh U T k epsilon omega alpha.water';legacy.inputs.foSFVPatch='outlet';
    a.api.restoreProject(legacy);assert.equal(a.d.getElementById('foResidualMode').value,'auto');assert.equal(a.d.getElementById('foResidualFields').value,'p U k omega');assert.equal(a.d.getElementById('foSFVMode').value,'manual');assert.equal(a.d.getElementById('foSFVPatch').value,'outlet');assert.equal(a.d.getElementById('initialU').value,'(0 0 0)');
  }finally{a.close();}
});
