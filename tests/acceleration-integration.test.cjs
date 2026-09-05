const {test}=require('node:test'),assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const csv=(rawText,name='input.csv')=>({name,size:rawText.length,text:async()=>rawText});
function setup(a,solver='interFoam'){a.set('includeSnappy',false);a.set('solver',solver);a.set('adjustTimeStep','no');a.set('enableAcceleration',true);}
for(const solver of ['interFoam','interIsoFoam'])test(`${solver}: CSV produces SI source with original sign, sample preview and no mesh motion`,async()=>{const a=app();try{
  setup(a,solver);await a.api.importAccelerationFile(csv('time,ax,ay,az\n0,100,-200,0\n2,-100,0,50'));a.set('accelerationUnit','Gal');
  assert.match(a.file('constant/acceleration/translation.dat'),/\(0 \(\(1 -2 0\) \(0 0 0\) \(0 0 0\)\)\)/);
  assert.match(a.file('constant/fvOptions'),/timeDataFileName "\$FOAM_CASE\/constant\/acceleration\/translation.dat"/);
  assert.match(a.file('constant/fvOptions'),/tabulatedAccelerationSource/);assert.doesNotMatch(a.file('constant/fvOptions'),/cellSet|selectionMode/);
  assert.match(a.file('constant/g'),/value\s+\(0 -9.81 0\)/);assert.equal(a.file('constant/dynamicMeshDict'),undefined);
  assert.equal(a.d.querySelectorAll('#accelerationPlot polyline').length,3);assert.match(a.d.getElementById('accelerationStatus').textContent,/2点/);
  assert.deepEqual([...a.api.blockingErrors()],[]);assert.equal(a.errors.length,0);
}finally{a.close();}});
test('acceleration unit changes re-convert raw values once and v2 JSON roundtrip reproduces output',async()=>{const a=app();try{
  setup(a);const raw='0,1,0,-1\n2,0,2,0\n';await a.api.importAccelerationFile(csv(raw));a.set('accelerationUnit','g');
  assert.match(a.file('constant/acceleration/translation.dat'),/9.80665 0 -9.80665/);a.set('accelerationUnit','m/s2');assert.match(a.file('constant/acceleration/translation.dat'),/\(1 0 -1\)/);
  a.set('accelerationUnit','Gal');const before=a.file('constant/acceleration/translation.dat'),data=JSON.parse(JSON.stringify(a.api.projectSnapshot()));
  a.click('clearAcceleration');assert.ok(a.api.blockingErrors().some(e=>e.includes('CSVを読み込')));a.api.restoreProject(data);
  assert.equal(a.file('constant/acceleration/translation.dat'),before);assert.equal(a.file('constant/acceleration/input.csv'),raw);assert.equal(a.d.getElementById('accelerationUnit').value,'Gal');
  assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('invalid replacement removes old source and disabling acceleration clears active errors',async()=>{const a=app();try{
  setup(a);await a.api.importAccelerationFile(csv('0,1,0,0\n2,0,0,0'));assert.ok(a.file('constant/fvOptions'));
  await a.api.importAccelerationFile(csv('time,ax,ay,az\n0,NaN,0,0\n2,0,0,0','broken.csv'));
  assert.equal(a.file('constant/fvOptions'),undefined);assert.equal(a.d.getElementById('downloadZip').disabled,true);assert.match(a.d.getElementById('accelerationStatus').textContent,/有限/);
  a.set('enableAcceleration',false);assert.deepEqual([...a.api.blockingErrors()],[]);assert.doesNotMatch(a.d.getElementById('accelerationStatus').className,/danger/);
  a.set('enableAcceleration',true);assert.equal(a.d.getElementById('downloadZip').disabled,true);
  await a.api.importAccelerationFile(csv('0,0,0,0\n2,0,0,0'));assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('time range button leaves a final-step margin and configures bounded adaptive time',async()=>{const a=app();try{
  setup(a);a.set('adjustTimeStep','yes');a.set('maxDeltaT','0');await a.api.importAccelerationFile(csv('0,1,0,0\n1,0,0,0'));
  assert.ok(a.api.blockingErrors().some(e=>e.includes('maxDeltaT')));a.click('applyAccelerationTimeRange');
  assert.equal(a.d.getElementById('maxDeltaT').value,'0.001');assert.equal(a.d.getElementById('startTime').value,'0');assert.ok(Number(a.d.getElementById('endTime').value)<1);
  assert.deepEqual([...a.api.blockingErrors()],[]);a.set('startTime','');assert.ok(a.api.blockingErrors().some(e=>e.includes('開始時刻')));
  a.set('startTime','0');a.set('endTime','1');assert.ok(a.api.blockingErrors().some(e=>e.includes('余裕')));
  a.set('writeControl','adjustableRunTime');a.click('applyAccelerationTimeRange');assert.equal(a.d.getElementById('endTime').value,'0.998');assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('unsupported solvers, mesh motion, restarts and invalid gravity visibly block acceleration export',async()=>{const a=app();try{
  setup(a);await a.api.importAccelerationFile(csv('0,0,0,0\n2,0,0,0'));a.set('solver','pimpleFoam');assert.ok(a.api.blockingErrors().some(e=>e.includes('interFoam')));
  a.set('solver','interFoam');a.set('meshMotion','rigid');assert.ok(a.api.blockingErrors().some(e=>e.includes('加速度CSVは固定')));
  a.set('meshMotion','static');a.set('startFrom','latestTime');assert.ok(a.api.blockingErrors().some(e=>e.includes('startTime')));
  a.set('startFrom','startTime');a.set('gVec','(NaN 0 0)');assert.ok(a.api.blockingErrors().some(e=>e.includes('基準重力')));
  a.set('gVec','(0 0 -9.81)');assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('legacy project clears auxiliary history and malformed acceleration restoration is atomic',async()=>{const a=app();try{
  setup(a);await a.api.importAccelerationFile(csv('0,1,0,0\n2,0,0,0'));const current=JSON.parse(JSON.stringify(a.api.projectSnapshot())),before=a.file('constant/acceleration/translation.dat');
  const corrupt=JSON.parse(JSON.stringify(current));corrupt.inputs.caseName='should_not_apply';corrupt.auxiliary.acceleration.rawText='0,NaN,0,0\n2,0,0,0';
  assert.throws(()=>a.api.restoreProject(corrupt));assert.equal(a.file('constant/acceleration/translation.dat'),before);assert.notEqual(a.d.getElementById('caseName').value,'should_not_apply');
  const legacy={...current,version:1};delete legacy.auxiliary;delete legacy.inputs.enableAcceleration;delete legacy.inputs.accelerationUnit;
  a.api.restoreProject(legacy);assert.equal(a.d.getElementById('enableAcceleration').checked,false);assert.equal(a.file('constant/fvOptions'),undefined);assert.equal(a.api.projectSnapshot().auxiliary.acceleration,null);
}finally{a.close();}});
test('clearing an in-flight CSV cannot restore its stale acceleration data',async()=>{const a=app();try{
  setup(a);let resolve;const pending=a.api.importAccelerationFile({name:'slow.csv',size:30,text:()=>new Promise(r=>resolve=r)});
  assert.equal(a.d.getElementById('downloadZip').disabled,true);a.click('clearAcceleration');resolve('0,9,0,0\n2,0,0,0');await pending;
  assert.equal(a.file('constant/fvOptions'),undefined);assert.equal(a.api.projectSnapshot().auxiliary.acceleration,null);assert.equal(a.errors.length,0);
}finally{a.close();}});
