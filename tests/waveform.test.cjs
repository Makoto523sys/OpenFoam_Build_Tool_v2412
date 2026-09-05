const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../src/waveform.js'),A=require('../src/acceleration.js');
const axis=(kind='sine',values={})=>({kind,amplitude:2,cycleMode:'period',cycle:1,phase:0,offset:0,expression:'b + A*sin(2*pi*f*tau + phi)',...values});
const config=(values={})=>({startTime:0,endTime:2,sampleInterval:.01,unit:'m/s2',axes:{x:axis(),y:axis('zero'),z:axis('zero')},...values});
const near=(value,expected,tol=1e-11)=>assert.ok(Math.abs(value-expected)<tol,`${value} ≈ ${expected}`);
test('axis-specific periods, phases, offsets and zero input match independent analytic values',()=>{
  const c=config({startTime:3,endTime:5,axes:{x:axis(),y:axis('sine',{amplitude:3,cycleMode:'frequency',cycle:2,phase:90,offset:-1}),z:axis('cosine',{amplitude:.5,cycle:4,phase:180,offset:2})}}),r=W.generate(c);
  for(const s of r.samples){const t=s.time-3;near(s.acceleration[0],2*Math.sin(2*Math.PI*t));near(s.acceleration[1],-1+3*Math.cos(4*Math.PI*t));near(s.acceleration[2],2-.5*Math.cos(Math.PI*t/2));}
  near(r.samples[25].acceleration[0],2);near(r.samples[0].acceleration[1],2);near(r.samples[0].acceleration[2],1.5);
});
test('period and frequency definitions produce identical samples; signed amplitudes and degree phases work',()=>{
  const left=config({axes:{x:axis('sine',{cycle:2,amplitude:-3,phase:-90}),y:axis('constant',{offset:7}),z:axis('zero')}}),right=structuredClone(left);right.axes.x.cycleMode='frequency';right.axes.x.cycle=.5;
  assert.deepEqual(W.generate(left).samples,W.generate(right).samples);near(W.generate(left).samples[0].acceleration[0],3);assert.equal(W.generate(left).samples[0].acceleration[1],7);
});
test('nonintegral final sampling interval includes each endpoint once without accumulated time drift',()=>{
  const r=W.generate(config({startTime:.1,endTime:1.03,sampleInterval:.03,axes:{x:axis('constant',{offset:0}),y:axis('zero'),z:axis('zero')}}));
  assert.equal(r.samples[0].time,.1);assert.equal(r.samples.at(-1).time,1.03);assert.equal(new Set(r.samples.map(s=>s.time)).size,r.samples.length);
  assert.deepEqual(A.validate(r.samples),[]);
  const exact=W.generate(config({startTime:0,endTime:.3,sampleInterval:.1,axes:{x:axis('zero'),y:axis('zero'),z:axis('zero')}}));assert.deepEqual(exact.samples.map(s=>s.time),[0,.1,.2,.3]);
});
test('Gal/g conversion is applied once and generated CSV retains the chosen input unit',()=>{
  for(const [unit,factor]of [['Gal',.01],['g',9.80665]]){const r=W.generate(config({unit,axes:{x:axis('constant',{offset:3}),y:axis('zero'),z:axis('zero')}}));near(r.samples[0].acceleration[0],3*factor);const text=W.csv(r,unit);assert.match(text,new RegExp('ax\\['+unit+'\\]'));assert.deepEqual(A.parseCSV(text,{unit}),r.rawSamples);}
});
test('math expressions have mathematical power precedence and support damped/combined signals',()=>{
  assert.equal(W.compile('-2^2 + 2^3^2 + 2^-2')({}),508.25);near(W.compile('min(2,3) + max(4,1) + sqrt(9) + abs(-2) + log(e)')({}),12);
  const r=W.generate(config({startTime:2,axes:{x:axis('expression',{expression:'b + A*exp(-0.5*tau)*sin(2*pi*f*tau + phi)',offset:1}),y:axis('expression',{expression:'t + tau^2'}),z:axis('zero')},endTime:4}));
  for(const s of r.samples){const tau=s.time-2;near(s.acceleration[0],1+2*Math.exp(-.5*tau)*Math.sin(2*Math.PI*tau));near(s.acceleration[1],s.time+tau*tau);}
});
test('expressions reject executable JavaScript, unknown variables, malformed syntax and nonfinite intermediate values',()=>{
  for(const expr of ['globalThis.alert(1)','Math.sin(t)','constructor(1)','t;1','t[0]','t=1','A sin(t)','sin()','max(1)','cos(1,2)','sin(t','2**3','1e309','__proto__','x+t'])assert.throws(()=>W.compile(expr),undefined,expr);
  for(const expr of ['1/0','sqrt(-1)','log(-1)','exp(10000)','1/(1/0)','min(1/0,1)'])assert.throws(()=>W.compile(expr)({}),/有限値/,expr);
  assert.throws(()=>W.generate(config({axes:{x:axis('expression',{expression:'sqrt(tau-0.1)'}),y:axis('zero'),z:axis('zero')}})),/X: t=0 s/);
});
test('generation rejects bad times, unsafe point counts and under-sampled sine waves',()=>{
  for(const values of [{startTime:-1},{endTime:0},{sampleInterval:0},{sampleInterval:NaN},{sampleInterval:1e-10},{endTime:Infinity}])assert.throws(()=>W.generate(config(values)));
  assert.throws(()=>W.generate(config({sampleInterval:.06})),/20点/);assert.ok(W.generate(config({sampleInterval:.05})).warnings.some(w=>w.includes('100点')));
  for(const values of [{cycle:0},{cycle:Infinity},{cycleMode:'radians'},{phase:NaN},{amplitude:Infinity}])assert.throws(()=>W.generate(config({axes:{x:axis('sine',values),y:axis('zero'),z:axis('zero')}})));
  assert.throws(()=>W.compile('('.repeat(40)+'1'+')'.repeat(40)),/入れ子/);
});
