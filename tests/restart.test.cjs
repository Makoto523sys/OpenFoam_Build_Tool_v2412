const {test}=require('node:test'),assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
test('pisoFoam is explicitly selectable with PISO controls and fixed time stepping',()=>{
 const a=app();try{a.set('includeSnappy',false);a.set('solver','pisoFoam');a.click('generateBtn');assert.match(a.file('system/fvSolution'),/\nPISO\n/);assert.doesNotMatch(a.file('system/fvSolution'),/residualControl|\nPIMPLE\n/);a.set('adjustTimeStep','yes');assert.match(a.api.blockingErrors().join('\n'),/固定時間刻み/);}finally{a.close();}
});
test('restart preserves checkpoint and skips initialization while AMR parallel reconstructs topology first',()=>{
 const a=app();try{a.set('includeSnappy',false);a.set('solver','interFoam');a.set('meshMotion','refine');a.set('nProc','2');a.set('caseRunMode','restart');a.set('startFrom','startTime');a.set('startTime','.1');a.click('generateBtn');const run=a.file('Allrun');
 assert.doesNotMatch(run,/runFresh blockMesh|runFresh setFields|runFresh snappyHexMesh/);
 assert.match(run,/runFresh decomposePar -force -time 0.1/);
 assert.ok(run.indexOf('runFresh reconstructParMesh\n')<run.indexOf('runFresh reconstructPar\n'));
 assert.match(run,/log\.\$1\.restart/);const config=JSON.parse(a.file('system/caseBuilderChecks.json'));assert.equal(config.runMode,'restart');assert.equal(config.meshMotion,'refine');
 const s=JSON.parse(JSON.stringify(a.api.projectSnapshot()));a.set('caseRunMode','fresh');a.api.restoreProject(s);assert.equal(a.d.getElementById('caseRunMode').value,'restart');
 a.set('startTime','0');assert.match(a.api.blockingErrors().join('\n'),/再開/);
 }finally{a.close();}
});
test('legacy project defaults to fresh mode',()=>{
 const a=app();try{a.set('caseRunMode','restart');const s=JSON.parse(JSON.stringify(a.api.projectSnapshot()));delete s.inputs.caseRunMode;a.api.restoreProject(s);assert.equal(a.d.getElementById('caseRunMode').value,'fresh');}finally{a.close();}
});
test('AMR restart geometry audit accepts split convex cells and rejects genuinely concave cells',()=>{
 const r=require('node:child_process').spawnSync('python3',[require.resolve('./test_restart_runtime.py')],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);
});
