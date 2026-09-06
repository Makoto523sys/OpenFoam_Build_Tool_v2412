/* Auxiliary inputs have their own state: neither is a meshing surface. */
let accelerationInput=null, accelerationError='', accelerationCache=null;
let initialWaterInput=null, initialWaterError='', waterExportCache=null;
let auxiliaryBusy=0, auxiliaryReady=false, waterViewer=null;
let accelerationRevision=0, waterRevision=0;
const auxiliaryDefaults={enableAcceleration:false,accelerationUnit:'m/s2',accelerationConvention:'container',accelerationTail:'none',accelerationTailStep:'0.01',waterRegionMode:'box',waterRegionScale:'1',...waveformDefaults};

function csvAccelerationSamples(){
  if(!accelerationInput)return [];
  const unit=val('accelerationUnit');
  if(accelerationCache?.input===accelerationInput&&accelerationCache.unit===unit)return accelerationCache.samples;
  const factor=Acceleration.unitFactor(unit),raw=Acceleration.parseCSV(accelerationInput.rawText,{unit});
  const samples=raw.map(s=>({time:s.time,acceleration:s.acceleration.map(x=>x*factor)}));
  const errors=Acceleration.validate(samples);if(errors.length)throw Error(errors.join('\n'));
  accelerationCache={input:accelerationInput,unit,samples};return samples;
}
function waterOutputName(){return 'initialWater/water.stl';}
function waterSurfaceText(){
  if(!initialWaterInput)return '';
  const scale=Number(val('waterRegionScale'));
  if(waterExportCache?.input===initialWaterInput&&waterExportCache.scale===scale)return waterExportCache.text;
  const p=initialWaterInput.prepared;
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(p.volume*scale**3)||p.volume*scale**3<=0||[...p.bounds.min,...p.bounds.max].some(x=>!Number.isFinite(x*scale)))throw Error('初期水領域STLの単位変換が不正です。');
  const text=WaterRegion.exportSTL({...p,scale});waterExportCache={input:initialWaterInput,scale,text};return text;
}
function accelerationRunOptions(){const n=id=>val(id).trim()===''?NaN:Number(val(id));return {startTime:n('startTime'),endTime:n('endTime'),deltaT:n('deltaT'),adjustTimeStep:val('adjustTimeStep')==='yes',maxDeltaT:n('maxDeltaT'),writeControl:val('writeControl')};}
function auxiliaryInputErrors(c){
  const errs=[];
  if(auxiliaryBusy)errs.push('CSV / 初期水領域STLを読み込み中です。');
  if(checked('enableAcceleration')){
    const inputLabel=accelerationSourceMode()==='waveform'?'入力加速度（数式）':'加速度CSV';
    if(!['interFoam','interIsoFoam'].includes(c.solver.id))errs.push(inputLabel+'にはinterFoam / interIsoFoamを選択してください。');
    if(val('meshMotion')!=='static')errs.push(inputLabel+'は固定メッシュの並進加速度に対応しています。メッシュ運動を固定メッシュにしてください。');
    if(val('startFrom')!=='startTime')errs.push(inputLabel+'では開始方法をstartTimeにして、解析時間を指定してください。');
    if(val('stopAt')!=='endTime')errs.push(inputLabel+'では停止条件をendTimeにしてください。');
    if(!strictVector(val('gVec')))errs.push(inputLabel+'の基準重力 g は (x y z) の有限値で指定してください。');
    const source=accelerationSourceMode();
    if(!['csv','waveform'].includes(source))errs.push('使用する加速度をCSVまたは数式から選択してください。');
    else if(source==='csv'&&accelerationError)errs.push(accelerationError);
    else if(source==='csv'&&!accelerationInput)errs.push('加速度CSVを読み込んでください。');
    else try{errs.push(...Acceleration.validateRun(accelerationSamples(),accelerationRunOptions()).map(e=>source==='waveform'?e.replaceAll('CSV','波形'):e));}catch(e){errs.push(e.message);}
  }
  if(c.vof){
    if(!['box','stl'].includes(val('waterRegionMode')))errs.push('初期水領域の指定方法を選択してください。');
    if(val('waterRegionMode')==='stl'){
      if(initialWaterError)errs.push(initialWaterError);
      else if(!initialWaterInput)errs.push('初期水領域専用STLを読み込んでください。');
      else try{waterSurfaceText();}catch(e){errs.push(e.message);}
    }
  }
  return errs;
}
function auxiliaryInputFiles(c){
  const files=[],add=(path,text)=>files.push({path:c.caseName+'/'+path,text});
  if(checked('enableAcceleration')&&(accelerationSourceMode()==='waveform'||accelerationSourceMode()==='csv'&&accelerationInput&&!accelerationError)){
    try{
      add('constant/acceleration/translation.dat',Acceleration.table(accelerationSamples()));
      add('constant/acceleration/conversion.json',JSON.stringify({convention:val('accelerationConvention'),gravity:strictVector(val('gVec')),tail:val('accelerationTail'),tailStep:Number(val('accelerationTailStep')),solverConvention:'gEffective = g - aContainer',tailMeaning:'Zero container acceleration after the last input sample; the next sample is zero. Baseline gravity remains active. v2412 spline interpolation can overshoot near the join.'},null,2)+'\n');
      add('constant/acceleration/container.csv','time,ax,ay,az\n'+accelerationSamples().map(s=>[s.time,...s.acceleration].join(',')).join('\n')+'\n');
      if(accelerationSourceMode()==='waveform')files.push(...waveformCaseFiles(c.caseName));else add('constant/acceleration/input.csv',accelerationInput.rawText);
      add('constant/fvOptions',header('dictionary','fvOptions','constant')+Acceleration.fvOptions({tablePath:'constant/acceleration/translation.dat'}));
    }catch(e){/* The validation panel blocks export while the input is invalid. */}
  }
  if(c.vof&&val('waterRegionMode')==='stl'&&initialWaterInput&&!initialWaterError){
    try{add('constant/triSurface/'+waterOutputName(),waterSurfaceText());}catch(e){/* See validation panel. */}
  }
  return files;
}
function initialWaterSelection(){
  if(val('waterRegionMode')==='stl')return WaterRegion.selectionBody({file:waterOutputName(),alpha:1});
  return `    boxToCell\n    {\n        box ${val('waterBoxMin')} ${val('waterBoxMax')};\n        fieldValues\n        (\n            volScalarFieldValue alpha.water 1\n        );\n    }\n`;
}
function auxiliaryGuide(c){
  let text='';
  if(c.vof)text+='## Initial water\n\n'+(val('waterRegionMode')==='stl'?`Initial-water surface: constant/triSurface/${waterOutputName()}. This surface is used ONLY by setFields; it is excluded from snappyHexMesh and surfaceFeatureExtract. It shares the model coordinate system and is independently converted to metres. Cell centres inside the closed outward-oriented surface receive alpha.water=1; all other cells start at 0. Cut-cell fractions are not integrated. Check self-intersections with surfaceCheck and inspect alpha.water after setFields.\n`:'The specified box sets alpha.water=1 inside, 0 outside. Coordinates are metres.\n');
  if(checked('enableAcceleration'))text+='\n## Prescribed container acceleration\n\n'+accelerationSourceDescription()+'constant/acceleration/translation.dat is converted to m/s2 exactly once. This is translational container acceleration without gravity, in a nonrotating container-fixed frame. The mesh stays fixed. OpenFOAM tabulatedAccelerationSource applies gEffective = g - aContainer; the GUI converts the selected input convention to container acceleration before export; see conversion.json. Zero-tail extension is explicit and retains baseline gravity. Only interFoam/interIsoFoam with static mesh are enabled. No angular motion or moving mesh is implied.\n\nOpenFOAM-v2412 uses spline interpolation (linear with two samples); it may overshoot between data points and rejects times outside the table. The graph shows sample-point connections, not the solver interpolation. Use a time step that resolves both the input and the sloshing response; keep every evaluated solver time within the CSV range, including restarted runs. Inspect g/gh, free-surface response, mass conservation and time-step sensitivity. Forces must use the solver-reconstructed p (with effective gh), not p_rgh or a reconstruction using only the base gravity. A constant +X container acceleration must act toward -X in this frame. For variable time steps, set a positive maxDeltaT. The CSV must extend at least one maximum time step beyond endTime, because the final evaluated time can exceed the requested end. The tool does not perform baseline correction or integrate acceleration to displacement.\n';
  return text+'\n';
}
async function importAccelerationFile(file){
  if(!file)return;
  $('accelerationSource').value='csv';$('enableAcceleration').checked=true;
  const revision=++accelerationRevision;auxiliaryBusy++;accelerationInput=null;accelerationError='';accelerationCache=null;generate();
  try{
    if(file.size>20*1024*1024)throw Error('加速度CSVは20 MB以下にしてください。');
    const rawText=await file.text();if(revision!==accelerationRevision)return;
    Acceleration.parseCSV(rawText,{unit:val('accelerationUnit')});
    accelerationInput={fileName:file.name,rawText};csvAccelerationSamples();
  }catch(e){if(revision===accelerationRevision){accelerationInput=null;accelerationError='加速度CSV: '+e.message;}}
  finally{auxiliaryBusy--;generate();}
}
async function importWaterRegionFile(file){
  if(!file)return;
  $('waterRegionMode').value='stl';
  const revision=++waterRevision;auxiliaryBusy++;initialWaterInput=null;initialWaterError='';waterExportCache=null;refreshWaterViewer();generate();
  try{
    if(file.size>80*1024*1024)throw Error('初期水領域STLは80 MB以下にしてください。');
    const buffer=await file.arrayBuffer();if(revision!==waterRevision)return;
    const prepared=WaterRegion.prepare(buffer,{scale:Number(val('waterRegionScale'))});
    initialWaterInput={fileName:file.name,prepared};
  }catch(e){if(revision===waterRevision)initialWaterError='初期水領域STL: '+e.message;}
  finally{auxiliaryBusy--;refreshWaterViewer(true);generate();}
}
function refreshWaterViewer(fit=false){waterViewer?.setFaces(initialWaterInput?.prepared.faces||[],fit);}
function statusNote(id,text,error=false){const el=$(id);el.textContent=text;el.className='note'+(error?' danger':'');}
function drawAccelerationPlot(samples){
  const svg=$('accelerationPlot');svg.replaceChildren();if(samples.length<2)return;
  const add=(tag,attrs,text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;svg.append(el);return el;};
  let peak=0;for(const s of samples)for(const a of s.acceleration)peak=Math.max(peak,Math.abs(a));peak=peak||1;
  const first=samples[0].time,last=samples.at(-1).time,x=t=>65+(t-first)/(last-first)*675,y=a=>108-a/peak*80;
  add('line',{x1:65,y1:108,x2:740,y2:108,stroke:'#94a3b8'});
  add('line',{x1:65,y1:20,x2:65,y2:196,stroke:'#94a3b8'});
  for(const [v,pos] of [[peak,28],[0,112],[-peak,192]])add('text',{x:58,y:pos,'text-anchor':'end','font-size':12,fill:'#475569'},Number(v.toPrecision(4)).toString());
  add('text',{x:65,y:215,'font-size':12,fill:'#475569'},first+' s');add('text',{x:740,y:215,'text-anchor':'end','font-size':12,fill:'#475569'},last+' s');add('text',{x:65,y:14,'font-size':12,fill:'#475569'},'m/s²');
  // Keep extrema in every bucket so narrow pulses remain visible in long records.
  const stride=Math.max(1,Math.ceil(samples.length/1200));
  for(let axis=0;axis<3;axis++){
    const ids=new Set([0,samples.length-1]);
    for(let i=0;i<samples.length;i+=stride){let min=i,max=i;for(let j=i+1;j<Math.min(samples.length,i+stride);j++){if(samples[j].acceleration[axis]<samples[min].acceleration[axis])min=j;if(samples[j].acceleration[axis]>samples[max].acceleration[axis])max=j;}ids.add(min);ids.add(max);}
    add('polyline',{points:[...ids].sort((a,b)=>a-b).map(i=>x(samples[i].time).toFixed(2)+','+y(samples[i].acceleration[axis]).toFixed(2)).join(' '),fill:'none',stroke:['#dc2626','#15803d','#2563eb'][axis],'stroke-width':1.7,'stroke-dasharray':['none','7 3','2 3'][axis]});
    add('text',{x:550+axis*65,y:14,'font-size':12,fill:['#dc2626','#15803d','#2563eb'][axis]},['X','Y','Z'][axis]);
  }
}
function updateAuxiliaryInputsUI(){
  if(!auxiliaryReady)return;
  updateWaveformUI();
  const c=cfg(),stl=val('waterRegionMode')==='stl';
  $('waterBoxControls').hidden=stl;$('waterRegionPreview').hidden=!stl||!initialWaterInput;
  let waterText=!c.vof?'VOFソルバー選択時に初期水領域を出力します。設定と専用STLは保持されます。':stl?'初期水領域専用STLを読み込んでください。':'指定ボックス内を alpha.water = 1、外を0にします。';
  if(stl&&initialWaterInput){if(c.vof)waterText='初期水領域STLを読み込み済みです。';const p=initialWaterInput.prepared,s=Number(val('waterRegionScale')),coord=v=>'('+v.map(x=>Number((x*s).toPrecision(6))).join(' ')+')';waterText+=`\n${initialWaterInput.fileName} / ${p.faces.length.toLocaleString()}三角形 / 閉曲面・外向き\n範囲 [m]: ${coord(p.bounds.min)} → ${coord(p.bounds.max)}\nメッシュ用とは独立した初期水領域です。自己交差・位置関係はsurfaceCheckと実メッシュで確認してください。`;}
  const waterActiveError=c.vof&&stl?initialWaterError:'';statusNote('waterRegionStatus',waterActiveError||waterText,!!waterActiveError);
  if(stl)waterViewer?.draw();
  const enabled=checked('enableAcceleration'),source=accelerationSourceMode();
  let accelText=enabled?(source==='waveform'?'数式の波形を設定してください。':'加速度CSVを読み込んでください。'):'時刻歴加速度は無効です。通常の重力設定を使用します。',err=enabled&&source==='csv'?accelerationError:'',samples=[];
  if((source==='waveform'||accelerationInput)&&!err)try{
    samples=accelerationSamples();
    if(enabled){
      const peaks=[0,0,0];for(const sample of samples)sample.acceleration.forEach((a,i)=>peaks[i]=Math.max(peaks[i],Math.abs(a)));
      accelText=`${accelerationSourceLabel()} / ${samples.length.toLocaleString()}点 / ${samples[0].time} 〜 ${samples.at(-1).time} s\n入力点の最大絶対値 [m/s²]: X=${peaks[0]} / Y=${peaks[1]} / Z=${peaks[2]}`;
      if(source==='waveform')accelText+='\n'+waveformResult().warnings.join('\n');
      const validation=auxiliaryInputErrors(c).filter(e=>!e.startsWith('初期水')&&!e.startsWith('CSV /'));if(validation.length)err=validation.join('\n');
    }
  }catch(e){if(enabled)err=e.message;}
  statusNote('accelerationStatus',err||accelText,!!err);$('accelerationPreview').hidden=!enabled||!samples.length;if(enabled&&samples.length)drawAccelerationPlot(samples);
}
function auxiliaryProjectData(){return {acceleration:accelerationInput?{...accelerationInput}:null,accelerationError,water:initialWaterInput?{fileName:initialWaterInput.fileName,faces:initialWaterInput.prepared.faces.map(f=>({v:f.v,region:f.region}))}:null,waterError:initialWaterError};}
function auxiliaryProjectInputs(data){const inputs={...auxiliaryDefaults,...(data.inputs||{})};if(data.version<3)Object.assign(inputs,waveformDefaults);return inputs;}
function stageAuxiliaryProject(data){
  const source=data.version>=2?data.auxiliary||{}:{},inputs=auxiliaryProjectInputs(data);
  if(!['csv','waveform'].includes(inputs.accelerationSource))throw Error('作業ファイルの加速度入力方式が不正です。');
  if(data.version>=3&&inputs.accelerationSource==='waveform')Waveform.generate(waveformConfig(inputs));
  let acceleration=null,water=null;
  if(source.acceleration){const a=source.acceleration;if(typeof a.rawText!=='string'||a.rawText.length>20*1024*1024||typeof a.fileName!=='string')throw Error('作業ファイルの加速度CSVが不正です。');Acceleration.parseCSV(a.rawText,{unit:inputs.accelerationUnit});acceleration={fileName:a.fileName,rawText:a.rawText};}
  if(source.water){const w=source.water;if(typeof w.fileName!=='string'||!Array.isArray(w.faces)||w.faces.length>500000)throw Error('作業ファイルの初期水領域STLが不正です。');water={fileName:w.fileName,prepared:WaterRegion.prepareFaces(w.faces,{scale:Number(inputs.waterRegionScale)})};}
  return {acceleration,water,accelerationError:String(source.accelerationError||''),waterError:String(source.waterError||'')};
}
function applyAuxiliaryProject(staged){
  accelerationRevision++;waterRevision++;accelerationInput=staged.acceleration;initialWaterInput=staged.water;accelerationError=staged.accelerationError;initialWaterError=staged.waterError;accelerationCache=null;waterExportCache=null;refreshWaterViewer(true);
}
function initInputsUI(){
  initWaveformUI();
  waterViewer=new STLViewer($('waterRegionCanvas'),()=>{},{compassId:'waterAxes'});refreshWaterViewer(true);auxiliaryReady=true;
  $('accelerationPicker').addEventListener('change',async e=>{await importAccelerationFile(e.target.files[0]);e.target.value='';});
  $('waterRegionPicker').addEventListener('change',async e=>{await importWaterRegionFile(e.target.files[0]);e.target.value='';});
  $('clearAcceleration').addEventListener('click',()=>{accelerationRevision++;accelerationInput=null;accelerationError='';accelerationCache=null;generate();});
  $('clearWaterRegion').addEventListener('click',()=>{waterRevision++;initialWaterInput=null;initialWaterError='';waterExportCache=null;refreshWaterViewer(true);generate();});
  $('applyAccelerationTimeRange').addEventListener('click',()=>{try{const samples=accelerationSamples();if(samples.length<2)throw Error('先に有効な時刻歴を読み込むか、波形を生成してください。');const dt=Number(val('deltaT'));if(!Number.isFinite(dt)||dt<=0)throw Error('deltaTを正の数にしてください。');const adaptive=val('adjustTimeStep')==='yes',cap=Number(val('maxDeltaT'));const bound=Acceleration.runMargin({deltaT:dt,adjustTimeStep:adaptive,maxDeltaT:cap>0?cap:dt,writeControl:val('writeControl')}),start=samples[0].time,end=samples.at(-1).time-bound;if(end<=start)throw Error('時刻歴の長さに対して時間刻みが大きすぎます。deltaT / maxDeltaTを小さくしてください。');$('startFrom').value='startTime';$('stopAt').value='endTime';$('startTime').value=String(start);$('endTime').value=String(end);if(adaptive&&!(cap>0))$('maxDeltaT').value=String(dt);generate();setStatus('使用中の時刻歴に合わせて解析時間を設定しました。終端に時間刻みの余裕を残しています。');}catch(e){statusNote('accelerationStatus',e.message,true);}});
  $('fitWaterRegion').addEventListener('click',()=>refreshWaterViewer(true));
  $('downloadAccelerationExample').addEventListener('click',()=>saveBlob(new Blob(['time,ax,ay,az\n0,0,0,0\n0.25,1,0,0\n0.5,0,0,0\n0.75,-1,0,0\n1,0,0,0\n'],{type:'text/csv'}),'container_acceleration.csv'));
  generate();
}
