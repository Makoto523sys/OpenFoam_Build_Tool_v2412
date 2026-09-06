// Checks shared by the input UI and the generated runtime-check manifest.
const flowPurposes=new Set(['velocityInlet','volumetricFlowRateInlet','massFlowRateInlet','pressureInlet','totalPressureInlet','pressureOutlet','inletOutlet','volumetricFlowRateOutlet','massFlowRateOutlet','outletZeroGradient','atmosphere']);
const pressurePurposes=new Set(['pressureInlet','totalPressureInlet','pressureOutlet','atmosphere']);
const fixedInletPurposes=new Set(['velocityInlet','volumetricFlowRateInlet','massFlowRateInlet']);
function patchSources(){
  const sources=new Map(),put=(name,source)=>{if(!sources.has(name))sources.set(name,[]);sources.get(name).push(source);};
  for(const g of blockMeshGroupedPatches())put(g.name,{kind:'background',label:'背景 '+g.axes.join('/'),active:checked('includeBlockMesh')});
  for(const part of geometryParts.values())for(const name of new Set(part.faces.map(f=>f.patch)))put(name,{kind:'stl',label:'STL '+part.file,active:checked('includeSnappy')});
  if(val('meshMotion')==='ami')for(const name of ['rotorAMI','statorAMI'])put(name,{kind:'ami',label:'回転AMI',active:true});
  return sources;
}
function residualFieldCandidates(c=cfg()){
  const objects=currentFields().map(k=>allFieldTemplates[k].object),pressure=c.pMode==='p_rgh'?'p_rgh':'p';
  return [pressure,'U',...(c.compressible?['h']:c.heatOn?['T']:[]),'k','epsilon','omega','nuTilda'].filter(f=>objects.includes(f)||(f==='h'&&c.compressible));
}
function residualFieldNames(c=cfg()){return val('foResidualMode')==='auto'?residualFieldCandidates(c):listWords(val('foResidualFields'));}
function fluxPatchNames(){
  if(val('foSFVMode')==='manual')return [...new Set(listWords(val('foSFVPatch')))];
  const sources=patchSources();return getPatches().filter(p=>flowPurposes.has(p.purpose)&&(!sources.has(p.name)||sources.get(p.name).some(s=>s.active))).map(p=>p.name);
}
function renamePatchReferences(oldName,newName){
  if(oldName===newName)return;
  for(const id of ['foSFVPatch','foForcePatches','nonRotatingPatches'])$(id).value=listWords(val(id)).map(n=>n===oldName?newName:n).join(' ');
}
function layerTotals(n){
  const final=Number(val('finalLayerThickness')),r=Number(val('layerExpansionRatio'));
  const first=final/Math.pow(r,n-1);let total=0;for(let i=0;i<n;i++)total+=final/Math.pow(r,i);
  return {first,final,total};
}
function layeredPatches(){
  const patches=getPatches();return getGeometries().filter(g=>Number(g.layers)>0).flatMap(g=>geometryPatchNames(g).filter(name=>purposeType(patches.find(p=>p.name===name)?.purpose||'wallNoSlip')==='wall').map(name=>({name,n:Number(g.layers)})));
}
function planarPatch(faces){
  if(!faces.length)return true;
  const b=Geometry.bounds(faces),tol=Math.max(Math.hypot(...Geometry.sub(b.max,b.min))*1e-6,1e-12),first=faces[0];
  return faces.every(f=>Geometry.dot(f.n,first.n)>1-1e-8&&f.v.every(v=>Math.abs(Geometry.dot(Geometry.sub(v,first.v[0]),first.n))<=tol));
}
function patchMeasurement(p){
  const faces=allFaces().filter(f=>f.patch===p.name),scale=num('stlScale');
  if(faces.length){let area=0;const areaVector=[0,0,0];for(const f of faces){const a=Geometry.cross(Geometry.sub(f.v[1],f.v[0]),Geometry.sub(f.v[2],f.v[0])).map(x=>x*.5*scale*scale);area+=Math.hypot(...a);a.forEach((x,i)=>areaVector[i]+=x);}return {area,areaVector,source:'STL面'};}
  const b=backgroundMeshBounds(),defs=blockMeshFaceDefs().filter(f=>f.name===p.name);
  if(b&&defs.length){const ext=Geometry.sub(b.max,b.min),areaVector=[0,0,0];let area=0;for(const f of defs){const i='XYZ'.indexOf(f.axis[0]),a=ext.filter((_,j)=>j!==i).reduce((x,y)=>x*y,1);area+=a;areaVector[i]+=a*(f.axis[1]==='+'?1:-1);}return {area,areaVector,source:'背景面'};}
  return {area:Number(p.area),areaVector:null,source:'手入力面積'};
}
function specifiedInletFlow(p){
  if(p.purpose==='volumetricFlowRateInlet')return Number(p.Q);
  if(p.purpose==='massFlowRateInlet')return Number(p.mdot)/num('rho');
  if(p.purpose==='velocityInlet'){const m=patchMeasurement(p),u=strictVector(p.U);return u?(m.areaVector?Math.abs(Geometry.dot(u,m.areaVector)):Math.hypot(...u)*m.area):NaN;}
  return 0;
}
function boundaryCombinationErrors(patches,c=cfg()){
  if(c.compressible||!patches.length)return [];
  const zero=strictVector(val('initialU'))?.every(x=>x===0),inlets=patches.filter(p=>fixedInletPurposes.has(p.purpose)&&specifiedInletFlow(p)>1e-14);
  if(!zero||!inlets.length||patches.some(p=>pressurePurposes.has(p.purpose)))return [];
  const qIn=inlets.reduce((s,p)=>s+specifiedInletFlow(p),0),qOut=patches.filter(p=>['volumetricFlowRateOutlet','massFlowRateOutlet'].includes(p.purpose)).reduce((s,p)=>s+(p.purpose==='massFlowRateOutlet'?Number(p.mdot)/num('rho'):Number(p.Q)),0);
  if(qOut>0&&Math.abs(qIn-qOut)<=1e-6*Math.max(qIn,qOut))return [];
  return [`${inlets.map(p=>p.name).join(', ')}: 非ゼロの流入に対し、圧力条件を持つ実出口がなく初期内部速度が0です。出口の圧力条件、指定流量の収支、初期化を確認してください。pRefCell/pRefValueだけでは流出流束は作れません。`];
}
function caseInputErrors(c=cfg()){
  const errors=[],word=/^[A-Za-z_][A-Za-z0-9_]*$/;
  for(const [name,sources] of patchSources())if(sources.some(s=>s.kind==='stl'&&s.active)&&sources.some(s=>s.kind==='background'&&s.active))errors.push(`${name}: 背景パッチとSTL由来パッチが同名です。別の名前で区別してください。`);
  if(!strictVector(val('initialU')))errors.push('初期内部速度は (x y z) の有限値 [m/s] で指定してください。');
  for(const id of ['nOuter','nCorrectors'])if(!Number.isInteger(num(id))||num(id)<1)errors.push(`${id} は1以上の整数です。`);
  if(!Number.isInteger(num('nNonOrth'))||num('nNonOrth')<0)errors.push('nNonOrth は0以上の整数です。');
  if(checked('foResiduals')){const fields=residualFieldNames(c),available=residualFieldCandidates(c);if(!fields.length)errors.push('solverInfoの監視対象fieldを指定してください。');for(const f of fields)if(!available.includes(f))errors.push(`solverInfo: ${f} は現在のソルバー・モデルの解く場ではありません。候補: ${available.join(' ')}`);}
  if(checked('foSurfaceFieldValue')){
    const names=fluxPatchNames(),sources=patchSources(),registered=new Set(c.patches.map(p=>p.name));
    if(val('foSFVMode')==='manual'&&!names.length)errors.push('流量監視するpatch名を指定してください。');
    for(const name of names){if(!word.test(name))errors.push(`流量監視: 不正なパッチ名 ${name}`);else if(!registered.has(name))errors.push(`流量監視: ${name} は境界パッチ表にありません。`);else if(sources.has(name)&&!sources.get(name).some(s=>s.active))errors.push(`流量監視: ${name} のメッシュ出力が無効です。`);}
    if(val('foSFVField')==='rhoPhi'&&!c.vof)errors.push('rhoPhiの流量監視はVOF用です。単相ソルバーではphiを選択してください。');
    if(!['phi','rhoPhi'].includes(val('foSFVField')))errors.push('流量監視のfieldはphiまたはrhoPhiを選択してください。');
    if(!['sum','areaAverage','min','max'].includes(val('foSFVOperation')))errors.push('流量監視のoperationが未対応です。');
    if(!(Number(val('foSFVInterval'))>0))errors.push('流量監視の出力間隔は正の値です。');
  }
  for(const p of c.patches)if(p.purpose==='symmetryPlane'){
    const faces=allFaces().filter(f=>f.patch===p.name);if(!planarPatch(faces))errors.push(`${p.name}: symmetryPlaneは単一平面・共通法線が必要です。面を分けるか、解析意図に合う場合はsymmetryを選択してください。`);
  }
  if(checked('includeBlockMesh'))for(const g of blockMeshGroupedPatches()){
    if(g.type==='symmetryPlane'&&g.axes.length>1)errors.push(`${g.name}: 複数方向の背景面をsymmetryPlaneにまとめることはできません。`);
    if(g.type==='empty'){const cells=val('blockCells').trim().split(/\s+/).map(Number);for(const axis of g.axes){const i='XYZ'.indexOf(axis[0]);if(cells[i]!==1)errors.push(`${g.name}: emptyの厚み方向 ${axis[0]} は1セルにしてください。`);const other=blockMeshFaceDefs().find(f=>f.axis===axis[0]+(axis[1]==='+'?'-':'+'));if(other?.type!=='empty')errors.push(`${g.name}: emptyには対向する前後面の設定が必要です。`);}}
  }
  if(checked('includeSnappy')){
    for(const id of ['nCellsBetweenLevels','snapSolveIter'])if(!Number.isInteger(num(id))||num(id)<1)errors.push(`${id} は1以上の整数です。`);
    if(!(Number(val('snapTolerance'))>0))errors.push('snap toleranceは正の値です。');
    if(checked('snappyLayers')){
      const layers=layeredPatches();if(!layers.length)errors.push('層追加が有効ですが、層数が1以上の壁パッチがありません。形状表のlayersを設定してください。');
      for(const id of ['finalLayerThickness','layerExpansionRatio','layerMinThickness'])if(!Number.isFinite(Number(val(id)))||Number(val(id))<=0)errors.push(`${id} は正の有限値です。`);
      for(const p of layers){if(!Number.isInteger(p.n)||p.n<1||p.n>12)continue;const t=layerTotals(p.n);if(![t.first,t.total].every(x=>Number.isFinite(x)&&x>0))errors.push(`${p.name}: 層厚を計算できません。`);else if(num('layerMinThickness')>t.total)errors.push(`${p.name}: minThickness=${val('layerMinThickness')} が総層厚 ${fmt(t.total)} を超え、層が消失します。相対値 / mの指定も確認してください。`);}
    }
  }
  // With snappy, final patch survival is only known after meshing. Check the
  // explicit STL inlet/zero-gradient-outlet combination separately from the box.
  if(!checked('includeSnappy'))errors.push(...boundaryCombinationErrors(c.patches,c));
  else {const names=new Set(allFaces().map(f=>f.patch)),stl=c.patches.filter(p=>names.has(p.name));if(!c.patches.some(p=>pressurePurposes.has(p.purpose))&&stl.some(p=>p.purpose==='outletZeroGradient'||p.purpose==='inletOutlet'))errors.push(...boundaryCombinationErrors(stl,c));}
  return [...new Set(errors)];
}
function caseInputWarnings(c=cfg()){
  const warnings=[],stlNames=new Set(allFaces().map(f=>f.patch)),stl=c.patches.filter(p=>stlNames.has(p.name));
  if(checked('includeSnappy')&&stl.some(p=>['outletZeroGradient','inletOutlet'].includes(p.purpose))&&boundaryCombinationErrors(stl,c).length&&c.patches.some(p=>pressurePurposes.has(p.purpose)))warnings.push('要確認: STL入口・出口に圧力条件がなく、背景側の圧力条件に依存しています。snappy後に背景パッチが消える場合は実出口へ圧力条件を設定してください。Allrunで残存パッチを再検査します。対象: '+stl.map(p=>p.name).join(', '));
  if(checked('includeSnappy')&&!checked('snappyLayers')&&val('turbulenceType')!=='laminar')warnings.push('要確認: 壁面層は追加しません。必要な壁面解像度とyPlusを確認してください。層なしだけでは不正とは判定しません。');
  if(checked('snappyLayers')&&val('layerRelativeSizes')==='true'&&num('finalLayerThickness')<.01)warnings.push('要確認: 最外層の相対厚さが近傍セル寸法の1%未満です。mやmmとの取り違えと層の消失を確認してください。');
  if(c.patches.some(p=>p.purpose==='empty')&&checked('includeSnappy'))warnings.push('要確認: STLのempty条件は厚み方向1セルと前後面の対応を別途満たす必要があります。checkMeshの2次元判定と実メッシュを確認してください。');
  return warnings;
}
function flowMonitorText(names){
  if(!checked('foSurfaceFieldValue'))return '// Flow monitoring disabled.\n';
  const object=(id,patches,operation)=>`    ${id}\n    {\n        type surfaceFieldValue;\n        libs (fieldFunctionObjects);\n        writeControl ${val('foBasicWriteControl')};\n        writeInterval ${val('foSFVInterval')};\n        regionType patch;\n        ${patches.length===1?'name '+patches[0]:'names ('+patches.join(' ')+')'};\n        operation ${operation};\n        fields (${val('foSFVField')});\n        writeFields false;\n    }\n`;
  return '// Generated flow monitors; Allrun resolves automatic selections against the actual mesh.\n'+names.map(n=>object('patchFlux_'+n,[n],val('foSFVOperation'))).join('\n')+(names.length>1&&val('foSFVOperation')==='sum'?object('flowBalance',names,'sum'):'');
}
function runtimeCheckFiles(c,fields){
  const sources=patchSources(),names=fluxPatchNames();
  const config={version:1,solver:c.solver.id,compressible:c.compressible,rho:num('rho'),pressure:c.pMode==='p_rgh'?'p_rgh':'p',fields:fields.map(k=>allFieldTemplates[k].object),patches:c.patches.map(p=>({...p,sources:sources.get(p.name)||[{kind:'existing',label:'既存/手動',active:true}],inletFlow:specifiedInletFlow(p)})),flow:{enabled:checked('foSurfaceFieldValue'),mode:val('foSFVMode'),names,field:val('foSFVField'),operation:val('foSFVOperation'),writeControl:val('foBasicWriteControl'),writeInterval:Number(val('foSFVInterval'))},forcePatches:checked('foForces')||checked('foForceCoeffs')?listWords(val('foForcePatches')):[],residualFields:checked('foResiduals')?residualFieldNames(c):[]};
  return [{path:c.caseName+'/scripts/validate_case.py',text:runtimeCheckScript},{path:c.caseName+'/system/caseBuilderChecks.json',text:JSON.stringify(config,null,2)+'\n'},{path:c.caseName+'/system/flowMonitors',text:flowMonitorText(names)}];
}
function updateCaseChecksUI(){
  const c=cfg(),sources=patchSources(),residuals=residualFieldNames(c),flux=fluxPatchNames();
  $('foResidualFields').disabled=val('foResidualMode')==='auto';if(val('foResidualMode')==='auto')$('foResidualFields').value=residuals.join(' ');
  $('residualFieldsHelp').textContent='候補: '+residualFieldCandidates(c).join(' ')+(c.compressible?'。hはthermophysicalPropertiesから生成されるエンタルピーです。':'。代数的に計算するnut等は残差対象に含めません。');
  $('foSFVPatch').disabled=val('foSFVMode')==='auto';if(val('foSFVMode')==='auto')$('foSFVPatch').value=flux.join(' ');
  const old=val('foPatchCandidate');$('foPatchCandidate').replaceChildren();for(const p of c.patches){const option=document.createElement('option');option.value=p.name;option.textContent=p.name+' — '+(sources.get(p.name)?.map(s=>s.label).join(' / ')||'既存/手動');$('foPatchCandidate').append(option);}if(c.patches.some(p=>p.name===old))$('foPatchCandidate').value=old;
  for(const def of blockMeshFaceDefs())$('bm'+def.key+'Name').dataset.priorPatchName=$('bm'+def.key+'Name').value;
  $('addFluxPatch').disabled=!c.patches.length;
  $('fluxPatchHelp').textContent=val('foSFVMode')==='auto'?'Allrunで面数が1以上の実パッチへ絞り込み、個別流量と符号付き和を監視します。用途が未登録の入口・出口は自動判定しません。':'手動指定はメッシュ生成後にも存在と面数を検査し、見つからなければ停止します。';
  for(const row of $('patchTable').querySelectorAll('tbody tr')){const name=row.querySelector('[data-k="name"]').value;row.querySelector('[data-patch-source]').textContent=sources.get(name)?.map(s=>s.label+(s.active?'':'（出力無効）')).join(' / ')||'既存/手動';}
  const pressure=c.patches.filter(p=>pressurePurposes.has(p.purpose));$('boundarySetupStatus').className='note '+(caseInputWarnings(c).some(w=>w.includes('背景側'))?'warn':'');$('boundarySetupStatus').textContent=caseInputWarnings(c).filter(w=>w.includes('背景側')).join('\n')+'\n圧力条件: '+(pressure.map(p=>p.name+' ['+(sources.get(p.name)?.map(s=>s.label).join('/')||'手動')+']').join(', ')||'未設定（閉じた領域や流量収支が指定済みの系は別途確認）');
  $('algorithmHelp').textContent=c.solver.time==='steady'?'SIMPLEの残差基準は定常反復の終了条件です。':c.solver.id==='icoFoam'?'PISOでは外部反復の残差制御を出力しません。':`PIMPLEのresidualControlは時間ステップ内の外部反復用です。${num('nOuter')===1?'外部反復上限1では残差による短縮はありません。':''}解析時間全体の終了はendTime等で指定します。`;
  const unit=val('layerRelativeSizes')==='true'?'近傍セル寸法に対する比':'m';
  $('layerSummary').textContent=(checked('snappyLayers')?'層追加 有効':'層追加 無効')+' / 厚さ単位: '+unit+'。'+layeredPatches().map(p=>{const t=layerTotals(p.n);return `${p.name}: ${p.n}層、第一層 ${fmt(t.first)}、総厚さ ${fmt(t.total)}`;}).join(' / ')+'。形状表のlayersが既存形状への層数です。壁面解像度はyPlus出力で確認してください。';
  const lines=[],faces=allFaces();if(faces.length){const b=Geometry.bounds(faces);lines.push('メッシュ用STL全体 [m]: '+Geometry.sub(b.max,b.min).map(x=>fmt(x*num('stlScale'))).join(' × '));}
  for(const p of c.patches.filter(p=>fixedInletPurposes.has(p.purpose))){const m=patchMeasurement(p);lines.push(`${p.name}: 面積 ${fmt(m.area)} m² (${m.source})、|U| ${fmt(magVector(flowVelocity(p)))} m/s、入力流量目安 ${fmt(specifiedInletFlow(p))} m³/s`);}
  lines.push('STL法線の向き・実メッシュの面積で流量は変わります。単位や用途は自動変更しません。');$('physicalScaleSummary').textContent=lines.join('\n');
}
function caseCheckDefaults(data){
  const inputs=data.inputs||{},legacyFields='p p_rgh U T k epsilon omega alpha.water';
  return {initialU:'(0 0 0)',foResidualMode:!inputs.foResidualFields||inputs.foResidualFields===legacyFields?'auto':'manual',foSFVMode:inputs.foSFVPatch?'manual':'auto',layerRelativeSizes:'true',layerMinThickness:'0.05',layerExpansionRatio:'1.2',nCellsBetweenLevels:'3',snapTolerance:'2',snapSolveIter:'30',...inputs};
}
function initCaseChecksUI(){
  for(const def of blockMeshFaceDefs())$('bm'+def.key+'Name').addEventListener('input',event=>{
    const el=event.target,old=el.dataset.priorPatchName,name=el.value.trim();
    if(old&&old!==name&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)&&!blockMeshFaceDefs().some(f=>f.name===old)&&!patchRow(name)){
      const row=patchRow(old);if(row){row.querySelector('[data-k="name"]').value=name;row.dataset.patchName=name;}
      if(managedPatchNames.delete(old))managedPatchNames.add(name);renamePatchReferences(old,name);
    }
  },true);
  $('addFluxPatch').addEventListener('click',()=>{const name=val('foPatchCandidate');if(!name)return;$('foSFVPatch').value=[...new Set([...fluxPatchNames(),name])].join(' ');$('foSFVMode').value='manual';generate();});
  updateCaseChecksUI();
}
