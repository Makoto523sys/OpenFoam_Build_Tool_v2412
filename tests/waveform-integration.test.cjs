const {test}=require('node:test'),assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(a){a.set('includeSnappy',false);a.set('solver','interFoam');a.set('adjustTimeStep','no');}
const csv=text=>({name:'original.csv',size:text.length,text:async()=>text});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} ≈ ${b}`);
test('axis waveform controls are discoverable and generate native tables without uploading a CSV',()=>{const a=app();try{
  setup(a);assert.equal(a.d.getElementById('waveformControls').closest('[hidden]'),null);
  a.set('waveXAmplitude','2');a.set('waveXCycle','2');a.set('waveYKind','cosine');a.set('waveYAmplitude','3');a.set('waveYPhase','90');a.set('waveZKind','constant');a.set('waveZOffset','-0.5');a.click('useWaveform');
  assert.equal(a.d.getElementById('enableAcceleration').checked,true);assert.equal(a.d.getElementById('accelerationSource').value,'waveform');
  const samples=a.api.accelerationSamples();near(samples[50].acceleration[0],2);near(samples[25].acceleration[1],-3);assert.equal(samples[0].acceleration[2],-.5);
  assert.ok(a.file('constant/fvOptions'));assert.ok(a.file('constant/acceleration/generated.csv'));assert.equal(a.file('constant/acceleration/input.csv'),undefined);
  const metadata=JSON.parse(a.file('constant/acceleration/waveform.json'));assert.equal(metadata.axes.x.cycle,2);assert.equal(metadata.axes.y.phase,90);assert.equal(a.d.querySelectorAll('#accelerationPlot polyline').length,3);assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('switching period/frequency preserves the physical waveform and changes both value and label',()=>{const a=app();try{
  setup(a);a.set('waveXCycle','2');a.click('useWaveform');const before=plain(a.api.accelerationSamples());
  a.set('waveXCycleMode','frequency');assert.equal(a.d.getElementById('waveXCycle').value,'0.5');assert.match(a.d.getElementById('waveXCycleLabel').textContent,/Hz/);assert.deepEqual(plain(a.api.accelerationSamples()),before);
  a.set('waveXCycleMode','period');assert.equal(a.d.getElementById('waveXCycle').value,'2');assert.deepEqual(plain(a.api.accelerationSamples()),before);
}finally{a.close();}});
test('editing a formula recomputes immediately and invalid edits cannot export a stale waveform',()=>{const a=app();try{
  setup(a);a.click('useWaveform');a.set('waveXKind','expression');a.set('waveXExpression','A*exp(-tau)*cos(2*pi*f*tau)');near(a.api.accelerationSamples()[0].acceleration[0],1);
  a.set('waveXAmplitude','4');near(a.api.accelerationSamples()[0].acceleration[0],4);a.set('waveXExpression','sqrt(-1)');assert.equal(a.d.getElementById('downloadZip').disabled,true);assert.equal(a.file('constant/fvOptions'),undefined);assert.equal(a.file('constant/acceleration/translation.dat'),undefined);assert.match(a.d.getElementById('accelerationStatus').textContent,/X: t=0/);
  a.set('waveXExpression','0');assert.deepEqual([...a.api.blockingErrors()],[]);assert.equal(a.api.accelerationSamples()[0].acceleration[0],0);assert.equal(a.errors.length,0);
}finally{a.close();}});
test('CSV and waveform modes keep independent source values and units when switching',async()=>{const a=app();try{
  setup(a);const text='0,100,0,0\n2,-100,0,0';a.set('accelerationUnit','Gal');await a.api.importAccelerationFile(csv(text));const original=a.file('constant/acceleration/translation.dat');
  a.set('waveUnit','g');a.set('waveXKind','constant');a.set('waveXOffset','1');a.click('useWaveform');near(a.api.accelerationSamples()[0].acceleration[0],9.80665);assert.equal(a.file('constant/acceleration/input.csv'),undefined);
  a.set('accelerationSource','csv');assert.equal(a.file('constant/acceleration/translation.dat'),original);assert.equal(a.file('constant/acceleration/input.csv'),text);assert.equal(a.file('constant/acceleration/generated.csv'),undefined);
  a.set('accelerationSource','waveform');near(a.api.accelerationSamples()[0].acceleration[0],9.80665);a.click('clearAcceleration');assert.ok(a.file('constant/fvOptions'));assert.deepEqual([...a.api.blockingErrors()],[]);
}finally{a.close();}});
test('v3 project restores independent formulas and retained CSV; v2 files reset new waveform controls',async()=>{const a=app();try{
  setup(a);await a.api.importAccelerationFile(csv('0,7,0,0\n2,7,0,0'));a.set('waveYKind','expression');a.set('waveYExpression','2*sin(pi*tau)');a.set('waveUnit','Gal');a.click('useWaveform');const data=plain(a.api.projectSnapshot()),before=a.file('constant/acceleration/translation.dat');assert.equal(data.version,3);
  a.set('waveYExpression','9');a.set('accelerationSource','csv');a.api.restoreProject(data);assert.equal(a.file('constant/acceleration/translation.dat'),before);assert.equal(a.d.getElementById('waveYExpression').value,'2*sin(pi*tau)');
  a.set('accelerationSource','csv');assert.match(a.file('constant/acceleration/input.csv'),/0,7/);
  const legacy={...data,version:2};a.api.restoreProject(legacy);assert.equal(a.d.getElementById('accelerationSource').value,'csv');assert.equal(a.d.getElementById('waveYKind').value,'zero');assert.equal(a.d.getElementById('waveUnit').value,'m/s2');assert.ok(a.file('constant/acceleration/input.csv'));
}finally{a.close();}});
test('malformed active waveform projects are rejected before existing state changes',()=>{const a=app();try{
  setup(a);a.click('useWaveform');const before=plain(a.api.projectSnapshot()),bad=plain(before);bad.inputs.waveXKind='expression';bad.inputs.waveXExpression='window.alert(1)';bad.inputs.caseName='must_not_apply';
  assert.throws(()=>a.api.restoreProject(bad));assert.deepEqual(plain(a.api.projectSnapshot()),before);
}finally{a.close();}});
test('generated CSV download contains selected-unit numbers and can be loaded through the CSV workflow',async()=>{const a=app();try{
  setup(a);a.set('waveUnit','Gal');a.set('waveXKind','constant');a.set('waveXOffset','50');let blob;a.w.URL.createObjectURL=value=>{blob=value;return 'blob:test';};a.w.URL.revokeObjectURL=()=>{};a.w.HTMLAnchorElement.prototype.click=()=>{};a.click('downloadWaveformCSV');assert.ok(blob);
  const text=await new Promise((resolve,reject)=>{const reader=new a.w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});assert.match(text,/ax\[Gal\]/);assert.match(text,/\n0,50,0,0\n/);
  a.set('accelerationUnit','Gal');await a.api.importAccelerationFile(csv(text));near(a.api.accelerationSamples()[0].acceleration[0],.5);assert.equal(a.d.getElementById('accelerationSource').value,'csv');
}finally{a.close();}});
test('generated histories retain end-time checks and the range button accounts for final-step margin',()=>{const a=app();try{
  setup(a);a.set('waveEndTime','1');a.click('useWaveform');assert.ok(a.api.blockingErrors().some(e=>e.includes('余裕')));a.click('applyAccelerationTimeRange');assert.deepEqual([...a.api.blockingErrors()],[]);assert.equal(a.d.getElementById('endTime').value,'0.999');
  a.set('waveSampleInterval','0.1');assert.ok(a.api.blockingErrors().some(e=>e.includes('20点')));assert.equal(a.file('constant/fvOptions'),undefined);
}finally{a.close();}});
