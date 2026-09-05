const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/acceleration.js');
const samples=()=>[{time:0,acceleration:[1,-2,3]},{time:0.05,acceleration:[-1,2,-3]},{time:0.2,acceleration:[0,0,0]}];

test('CSV reads BOM, CRLF, optional SI header, quotes, scientific numbers and nonuniform time',()=>{
  assert.deepEqual(A.parseCSV('\uFEFF"time [s]","ax [m/s²]",ay [m/s^2],az [m/s2]\r\n0,1,-2,3\r\n0.05,-1,2,-3\r\n\r\n2e-1,"0",+0,.0\r\n'),samples());
  assert.deepEqual(A.parseCSV('0,1,-2,3\n0.05,-1,2,-3\n0.2,0,0,0'),samples());
});
test('CSV rejects missing or extra columns, blank values, infinity, malformed and nondecimal numbers',()=>{
  for(const row of ['0,1,2','0,1,2,3,4','0,,2,3','0,NaN,2,3','0,Infinity,2,3','0,1e999,2,3','0,0xff,2,3','0,1abc,2,3','0,"1,2,3','0,1"",2,3']) {
    assert.throws(()=>A.parseCSV(row+'\n1,0,0,0'),Error,row);
  }
  assert.throws(()=>A.parseCSV('time,ax,az,ay\n0,1,2,3\n1,0,0,0'),/見出し/);
});
test('CSV and project data require strictly increasing nonnegative time and two samples',()=>{
  for(const text of ['', 'time,ax,ay,az', '0,0,0,0', '-1,0,0,0\n0,0,0,0', '0,0,0,0\n0,1,2,3', '1,0,0,0\n0,1,2,3']) {
    assert.throws(()=>A.parseCSV(text),Error,text);
  }
  for(const input of [null,{},[],[{},{}],[null,null],[{time:'0',acceleration:[0,0,0]},{time:1,acceleration:[0,0,0]}],[{time:0,acceleration:[NaN,0,0]},{time:1,acceleration:[0,0,0]}],[{time:0,acceleration:[0,0]},{time:1,acceleration:[0,0,0]}]]) {
    assert.ok(A.validate(input).length,JSON.stringify(input));
    assert.throws(()=>A.table(input));
  }
});
test('coverage validation rejects extrapolation and invalid simulation time but permits covered intervals',()=>{
  assert.deepEqual(A.validate(samples(),{startTime:0,endTime:.2}),[]);
  assert.deepEqual(A.validate(samples(),{startTime:.01,endTime:.19}),[]);
  for(const options of [{startTime:-1,endTime:.1},{startTime:0,endTime:.21},{startTime:0,endTime:0},{startTime:.2,endTime:.1},{startTime:0},{startTime:'0',endTime:.1}]) {
    assert.ok(A.validate(samples(),options).length,JSON.stringify(options));
  }
  assert.match(A.validate(samples().slice(1),{startTime:0,endTime:.2}).join(''),/外挿/);
});
test('unit conversion is explicit, and header-unit mismatches cannot silently alter load magnitude',()=>{
  assert.equal(A.unitFactor('m/s²'),1);assert.equal(A.unitFactor('Gal'),.01);assert.equal(A.unitFactor('g'),9.80665);
  const gal=A.parseCSV('time [s],ax [Gal],ay [Gal],az [Gal]\n0,100,0,-100\n1,0,0,0',{unit:'Gal'});
  assert.deepEqual(gal[0].acceleration,[100,0,-100]);
  assert.deepEqual(gal[0].acceleration.map(x=>x*A.unitFactor('Gal')),[1,0,-1]);
  assert.throws(()=>A.parseCSV('time [ms],ax,ay,az\n0,0,0,0\n1,0,0,0'),/単位/);
  assert.throws(()=>A.parseCSV('time,ax [g],ay [g],az [g]\n0,0,0,0\n1,0,0,0'),/単位/);
  assert.throws(()=>A.unitFactor('mm/s2'),/単位/);
});
test('native table preserves translation sign, precision and zero angular terms without implicit integration',()=>{
  const data=[{time:1.123456789012345,acceleration:[1.2345678901234567,-2.123456789012345,0]},{time:1.123456789012346,acceleration:[-1,0,0]}];
  const text=A.table(data);
  assert.ok(text.includes('(1.123456789012345 ((1.2345678901234567 -2.123456789012345 0) (0 0 0) (0 0 0)))'));
  assert.ok(text.includes('(1.123456789012346 ((-1 0 0) (0 0 0) (0 0 0)))'));
  assert.match(text,/spline interpolation/);
  assert.deepEqual(data[0].acceleration,[1.2345678901234567,-2.123456789012345,0]);
});
test('native fvOptions targets U across the whole mesh and validates exported paths',()=>{
  const text=A.fvOptions();
  assert.match(text,/type tabulatedAccelerationSource;/);
  assert.match(text,/timeDataFileName "\$FOAM_CASE\/constant\/acceleration\/translation\.dat";/);
  assert.match(text,/U U;/);
  assert.doesNotMatch(text,/selectionMode|cellSet|coded|displacement/);
  assert.match(A.fvOptions({tablePath:'constant/input/acceleration.dat',name:'tankMotion'}),/^tankMotion/);
  for(const tablePath of ['../outside.dat','constant/../outside.dat','constant/a"; inject','constant/a\nb','/absolute.dat']) assert.throws(()=>A.fvOptions({tablePath}));
  assert.throws(()=>A.fvOptions({name:'bad name'}));
});
test('run validation reserves a real CSV tail to prevent fixed-step endTime overshoot',()=>{
  const record=last=>[{time:0,acceleration:[0,0,0]},{time:last,acceleration:[0,0,0]}];
  const options={startTime:0,endTime:1.1,deltaT:.3,adjustTimeStep:'no'};
  assert.match(A.validateRun(record(1.1),options).join(''),/余裕.*1.4/);
  assert.deepEqual(A.validateRun(record(1.5),options),[]);
  assert.deepEqual(A.validateRun(record(1.4),options),[]);
  assert.ok(A.validateRun(record(1.4-1e-8),options).length);
  assert.equal(A.runMargin(options),.3);
  assert.ok(A.validateRun(record(1.5),{...options,startTime:NaN}).length);
  for(const deltaT of [undefined,0,-.1,NaN,Infinity,'0.3']) assert.ok(A.validateRun(record(1.5),{...options,deltaT}).length);
});
test('adaptive run validation requires an explicit positive finite cap and uses the greater initial/capped step',()=>{
  const data=[{time:0,acceleration:[0,0,0]},{time:2,acceleration:[0,0,0]}];
  const options={startTime:0,endTime:1,deltaT:.1,adjustTimeStep:'yes'};
  for(const maxDeltaT of [undefined,0,-1,NaN,Infinity,'0.1']) assert.match(A.validateRun(data,{...options,maxDeltaT}).join(''),/maxDeltaT/);
  assert.deepEqual(A.validateRun(data,{...options,maxDeltaT:1}),[]);
  assert.ok(A.validateRun(data,{...options,maxDeltaT:1.01}).length);
  assert.equal(A.runMargin({...options,deltaT:.6,maxDeltaT:.2}),.6);
  assert.equal(A.runMargin({...options,deltaT:.6,adjustTimeStep:true,maxDeltaT:.8}),.8);
  assert.throws(()=>A.runMargin({...options,maxDeltaT:1,adjustTimeStep:'invalid'}));
});
test('adjustableRunTime write alignment uses a double-step tail and matches the range-button bound',()=>{
  const data=[{time:0,acceleration:[0,0,0]},{time:2,acceleration:[0,0,0]}];
  const options={startTime:0,endTime:1,deltaT:.2,adjustTimeStep:'yes',maxDeltaT:.5,writeControl:'adjustableRunTime'};
  assert.equal(A.runMargin(options),1);
  assert.deepEqual(A.validateRun(data,options),[]);
  assert.ok(A.validateRun(data,{...options,endTime:1.0001}).length);
  assert.equal(A.runMargin({...options,adjustTimeStep:'no',deltaT:.3}),.6);
  const endTime=data.at(-1).time-A.runMargin(options);
  assert.deepEqual(A.validateRun(data,{...options,endTime}),[]);
  assert.equal(A.runMargin({...options,writeControl:'runTime'}),.5);
});
