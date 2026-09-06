/* Per-axis waveform parameters are independent of the retained CSV input. */
const waveformDefaults={accelerationSource:'csv',waveStartTime:'0',waveEndTime:'10',waveSampleInterval:'0.01',waveUnit:'m/s2'};
for(const axis of ['X','Y','Z'])Object.assign(waveformDefaults,{['wave'+axis+'Kind']:axis==='X'?'sine':'zero',['wave'+axis+'Amplitude']:'1',['wave'+axis+'CycleMode']:'period',['wave'+axis+'Cycle']:'1',['wave'+axis+'Phase']:'0',['wave'+axis+'Offset']:'0',['wave'+axis+'Expression']:'b + A*sin(2*pi*f*tau + phi)'});
let waveformCache=null;
function waveformConfig(inputs){
  const read=id=>inputs?inputs[id]:val(id),number=id=>String(read(id)??'').trim()===''?NaN:Number(read(id));
  return {startTime:number('waveStartTime'),endTime:number('waveEndTime'),sampleInterval:number('waveSampleInterval'),unit:read('waveUnit'),axes:Object.fromEntries(['X','Y','Z'].map(axis=>[axis.toLowerCase(),{kind:read('wave'+axis+'Kind'),amplitude:number('wave'+axis+'Amplitude'),cycleMode:read('wave'+axis+'CycleMode'),cycle:number('wave'+axis+'Cycle'),phase:number('wave'+axis+'Phase'),offset:number('wave'+axis+'Offset'),expression:read('wave'+axis+'Expression')}]))};
}
function waveformResult(){
  const config=waveformConfig(),key=JSON.stringify(config);
  if(waveformCache?.key===key){if(waveformCache.error)throw Error(waveformCache.error);return waveformCache.result;}
  try{const result=Waveform.generate(config);waveformCache={key,result};return result;}catch(e){waveformCache={key,error:e.message};throw e;}
}
function accelerationSourceMode(){return val('accelerationSource');}
function accelerationSamples(){
  const raw=accelerationSourceMode()==='waveform'?waveformResult().samples:csvAccelerationSamples();
  if(!raw.length)return raw;
  return Acceleration.prepareSamples(raw,{convention:val('accelerationConvention'),gravity:strictVector(val('gVec')),tail:val('accelerationTail'),tailStep:Number(val('accelerationTailStep')),endTime:Number(val('endTime')),margin:val('accelerationTail')==='zero'?Acceleration.runMargin(accelerationRunOptions()):0});
}
function accelerationSourceLabel(){return accelerationSourceMode()==='waveform'?'数式で生成した波形':accelerationInput?.fileName||'CSV';}
function accelerationSourceDescription(){
  if(accelerationSourceMode()==='waveform')return 'Analytic waveform sampled at the specified interval. Input unit: '+val('waveUnit')+'. Parameters and exact expressions are retained in constant/acceleration/waveform.json; generated input-unit samples are in constant/acceleration/generated.csv. t is case time [s], tau=t-startTime of the waveform; phase entries are degrees and the expression variable phi is radians. ';
  return 'Input CSV columns: time [s], ax, ay, az; selected input unit: '+val('accelerationUnit')+'. Original CSV is retained in constant/acceleration/input.csv. ';
}
function waveformCaseFiles(root){
  const result=waveformResult(),config=waveformConfig();
  return [{path:root+'/constant/acceleration/generated.csv',text:Waveform.csv(result,config.unit)},{path:root+'/constant/acceleration/waveform.json',text:JSON.stringify({format:'OpenFOAM-Acceleration-Waveform',version:1,...config,formulas:result.formulas,timeDefinition:'t = case time [s]; tau = t - startTime [s]; phi = phase [deg] * pi / 180',warnings:result.warnings},null,2)+'\n'}];
}
function updateWaveformUI(){
  for(const axis of ['X','Y','Z']){
    const prefix='wave'+axis,kind=val(prefix+'Kind'),mode=val(prefix+'CycleMode'),cycle=Number(val(prefix+'Cycle'));
    $(prefix+'Oscillation').hidden=['zero','constant'].includes(kind);$(prefix+'Bias').hidden=kind==='zero';$(prefix+'Custom').hidden=kind!=='expression';
    $(prefix+'CycleLabel').textContent=mode==='period'?'周期 T [s]':'周波数 f [Hz]';$(prefix+'CycleMode').dataset.previousMode=mode;
    $(prefix+'CycleInfo').textContent=Number.isFinite(cycle)&&cycle>0?(mode==='period'?'f = '+Number((1/cycle).toPrecision(7))+' Hz':'T = '+Number((1/cycle).toPrecision(7))+' s'):'';
    const b=val(prefix+'Offset'),A=val(prefix+'Amplitude'),phase=val(prefix+'Phase'),frequency=mode==='period'?'1/'+val(prefix+'Cycle'):val(prefix+'Cycle');
    $(prefix+'Equation').textContent=kind==='zero'?'a'+axis+'(t) = 0':kind==='constant'?'a'+axis+'(t) = '+b:kind==='expression'?'a'+axis+'(t) = '+val(prefix+'Expression'):'a'+axis+'(t) = '+b+' + '+A+' × '+(kind==='sine'?'sin':'cos')+'(2π × ('+frequency+') × (t − t₀) + '+phase+'°)';
  }
  const mode=accelerationSourceMode();$('accelerationSourceHint').textContent=mode==='waveform'?'数式の設定を変更すると、生成波形とケース出力が更新されます。CSVは保持されます。':'読み込んだCSVを使用します。下の数式設定は「波形を生成して使用」で有効にできます。';
}
function initWaveformUI(){
  for(const axis of ['X','Y','Z'])$('wave'+axis+'CycleMode').addEventListener('input',e=>{
    const previous=e.target.dataset.previousMode||'period',current=e.target.value,input=$('wave'+axis+'Cycle'),value=Number(input.value);
    if(previous!==current&&Number.isFinite(value)&&value>0)input.value=String(1/value);
    e.target.dataset.previousMode=current;
  },{capture:true});
  $('useWaveform').addEventListener('click',()=>{$('accelerationSource').value='waveform';$('enableAcceleration').checked=true;generate();});
  $('downloadWaveformCSV').addEventListener('click',()=>{try{saveBlob(new Blob([Waveform.csv(waveformResult(),val('waveUnit'))],{type:'text/csv'}),'generated_acceleration.csv');}catch(e){statusNote('accelerationStatus','波形生成: '+e.message,true);}});
}
