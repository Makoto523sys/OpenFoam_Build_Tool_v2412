function allFaces(){return [...geometryParts.values()].flatMap(p=>p.faces);}
function selectedFaces(){return allFaces().filter(f=>f.selected);}
function rememberGeometry(){geometryHistory.push({faces:allFaces().map(f=>({patch:f.patch,hidden:f.hidden,selected:!!f.selected})),patches:getPatches()});if(geometryHistory.length>20)geometryHistory.shift();}
function fluidPointCoordinates(){const p=strictVector(val('locationInMesh')),scale=Number(val('stlScale'));return p&&Number.isFinite(scale)&&scale>0?p.map(x=>x/scale):null;}
function backgroundMeshBounds(){
  const min=strictVector(val('boxMin')),max=strictVector(val('boxMax')),scale=Number(val('convertToMeters'));
  if(!min||!max||!Number.isFinite(scale)||scale<=0||min.some((x,i)=>x>=max[i]))return null;
  return {min:min.map(x=>x*scale),max:max.map(x=>x*scale)};
}
function backgroundMeshDisplayBounds(){
  const bounds=backgroundMeshBounds(),scale=Number(val('stlScale'));
  if(!checked('includeBlockMesh')||!checked('showBackgroundMesh')||!bounds||!Number.isFinite(scale)||scale<=0)return null;
  return {min:bounds.min.map(x=>x/scale),max:bounds.max.map(x=>x/scale)};
}
function updateBackgroundMeshStatus(state){
  let text;
  if(!checked('includeBlockMesh'))text='blockMeshDictの出力が無効です。既存メッシュの範囲は表示しません。';
  else if(!checked('showBackgroundMesh'))text='背景領域の枠線を非表示にしています。';
  else if(state==='unset')text='背景領域を表示できません。boxMin < boxMax、convertToMeters、STLの単位を確認してください。';
  else {
    const b=backgroundMeshBounds();text='背景領域 [m]: '+['X','Y','Z'].map((axis,i)=>`${axis} ${fmt(b.min[i])} ～ ${fmt(b.max[i])}`).join(' / ');
    if(state==='clipped')text+='。画面外の部分があります。「STL・点・背景を全体表示」で確認できます。';
    if(state==='unavailable')text+='。3D表示を利用できません。';
  }
  const el=$('backgroundMeshStatus');if(el.textContent!==text)el.textContent=text;
  $('backgroundMeshLegend').hidden=!['onscreen','clipped'].includes(state);
}
function syncViewerOverlays(){viewer.setPoint(fluidPointCoordinates(),false);viewer.setDomain(backgroundMeshDisplayBounds(),false);}
function updateFluidPointStatus(state){
  const messages={unset:'保持点を表示できません。(x y z) の有限な座標 [m] と、STLの単位を確認してください。',empty:'メッシュ用STLを読み込むと保持点を表示します。',unavailable:'3D表示を利用できません。座標値は辞書へ反映されます。',hidden:'3D画面を表示すると保持点を確認できます。',offscreen:'保持点は現在の画面外です。「STL・点・背景を全体表示」で確認できます。',onscreen:'ピンクの保持点を表示中。座標の変更は点とsnappyHexMeshDictへ反映されます。'};
  const el=$('fluidPointStatus');if(el.textContent!==messages[state])el.textContent=messages[state];
  $('fluidPointLegend').hidden=!['onscreen','offscreen'].includes(state);
  $('locationInMesh').setAttribute('aria-invalid',String(state==='unset'));
}
function refreshViewer(fit=false){if(viewer){syncViewerOverlays();viewer.setFaces(allFaces(),fit);}if(workbenchReady){renderParts();updateSelection();}}
function updateSelection(){
  const fs=selectedFaces(),scale=Number(val('stlScale')),m=Geometry.measure(fs);
  $('selectionStatus').textContent=fs.length?`${fs.length.toLocaleString()} 三角形を選択 / 面積 ${fmt(m.area*scale*scale)} m² / ${[...new Set(fs.map(f=>f.patch))].join(', ')}`:'面を選択してください。';
  $('assignVisualPatch').disabled=!fs.length; $('hideSelection').disabled=!fs.length; $('isolateSelection').disabled=!fs.length;
  $('undoGeometry').disabled=!geometryHistory.length;
}
function clearVisualPatchStatus(){
  $('visualPatchStatus').hidden=true;$('assignedPatchLink').hidden=true;
}
function loadVisualPatch(name){
  $('visualPatchName').value=name;
  const p=getPatches().find(x=>x.name===name);
  if(p){
    $('visualPurpose').value=p.purpose;
    for(const [key,id] of Object.entries({U:'visualU',Q:'visualQ',mdot:'visualMdot',p:'visualP',T:'visualT',alpha:'visualAlpha'}))$(id).value=p[key];
  }
  clearVisualPatchStatus();
}
function visualPatchStatus(text,error=false){
  const el=$('visualPatchStatus');el.textContent=text;el.className='note '+(error?'danger':'ok');el.hidden=false;
  $('assignedPatchLink').hidden=error;
  setStatus(text);
}
function pickFace(f,add){
  const part=geometryParts.get(f.file);if(!part)return;
  if(!add)allFaces().forEach(x=>x.selected=false);
  const indices=Geometry.select(part.faces,part.topology,part.faces.indexOf(f),val('selectionMode'),num('selectionAngle',20));
  indices.forEach(i=>part.faces[i].selected=true);
  loadVisualPatch(f.patch);
  viewer?.recolor();updateSelection();
}
async function importGeometryFiles(files){
  if(!files.length)return;importBusy=true;generate();const errors=[];
  for(const file of files){
    try{
      if(!/\.stl$/i.test(file.name))throw Error('3D編集はSTLに対応しています。');
      if(file.size>80*1024*1024)throw Error('80 MB以下のSTLを使用してください。');
      const faces=Geometry.parseSTL(await file.arrayBuffer());
      if(allFaces().length+faces.length>750000)throw Error('作業全体で75万三角形までです。');
      let base=Geometry.word(fileStem(file.name)),fname=base+'.stl',suffix=2;
      while(geometryParts.has(fname)){fname=base+'_'+suffix+++'.stl';}
      base=fileStem(fname);
      faces.forEach(f=>{f.patch=base+'_'+f.region;f.file=fname;});
      const part={file:fname,originalName:file.name,faces,topology:Geometry.topology(faces)};
      if(!geometryParts.size&&getGeometries().length===1&&getGeometries()[0].file==='model.stl')$('geometryTable').querySelector('tbody').innerHTML='';
      geometryParts.set(fname,part);selectedGeometryFiles.set(fname,file);addGeometry(defaultGeometry(fname));
    }catch(e){errors.push(file.name+': '+e.message);}
  }
  geometryHistory.length=0;importBusy=false;$('includeSnappy').checked=true;refreshViewer(true);generate();
  $('geometryStatus').textContent=errors.length?errors.join(' / '):`${geometryParts.size} 個のSTL、${allFaces().length.toLocaleString()} 三角形。単位を確認して面を選択してください。`;
}
function renderParts(){
  const root=$('partList');root.replaceChildren();
  for(const [name,p] of geometryParts){
    const row=document.createElement('div');row.className='part-row';
    const text=document.createElement('span');text.textContent=`${p.originalName||name} (${p.faces.length.toLocaleString()}面) / 開放辺 ${p.topology.open} / 非多様体辺 ${p.topology.nonManifold}`;row.append(text);
    const button=(label,fn)=>{const b=document.createElement('button');b.className='ghost small';b.textContent=label;b.addEventListener('click',fn);row.append(b);};
    button('部品を選択',()=>{allFaces().forEach(f=>f.selected=f.file===name&&!f.hidden);viewer?.recolor();updateSelection();});
    button(p.faces.every(f=>f.hidden)?'表示':'非表示',()=>{rememberGeometry();const hide=!p.faces.every(f=>f.hidden);p.faces.forEach(f=>{f.hidden=hide;f.selected=false;});refreshViewer();});
    button('単独表示',()=>{rememberGeometry();allFaces().forEach(f=>{f.hidden=f.file!==name;f.selected=false;});refreshViewer();});
    root.append(row);
    const group=document.createElement('div');group.className='btns';
    for(const patch of [...new Set(p.faces.map(f=>f.patch))]){const b=document.createElement('button');b.className='light small';b.textContent=patch;b.addEventListener('click',()=>{allFaces().forEach(f=>f.selected=f.patch===patch&&!f.hidden);loadVisualPatch(patch);viewer?.recolor();updateSelection();});group.append(b);}
    root.append(group);
  }
}
function patchDefaults(name,purpose='wallNoSlip') {return {name,purpose,U:'(0 0 0)',normal:'(1 0 0)',area:'1',Q:'0',mdot:'0',p:'0',T:'293.15',alpha:'0'};}
function patchRow(name){return [...$('patchTable').querySelectorAll('tbody tr')].find(tr=>tr.querySelector('[data-k="name"]').value===name);}
function upsertPatch(p){const row=patchRow(p.name);if(row){for(const [k,v] of Object.entries(p)){const el=row.querySelector(`[data-k="${k}"]`);if(el)el.value=v;}}else addPatch({...patchDefaults(p.name),...p});}
function purposeType(purpose){return ['empty','symmetryPlane','symmetry','wedge','cyclic','cyclicAMI'].includes(purpose)?purpose:/wall/i.test(purpose)?'wall':'patch';}
function meshPatchRequirements(includeInactive=false){
  const required=new Map();
  if(includeInactive||checked('includeBlockMesh'))for(const g of blockMeshGroupedPatches())required.set(g.name,blockMeshPatchPurpose(g.name,g.type));
  if(includeInactive||checked('includeSnappy'))for(const p of geometryParts.values())for(const f of p.faces)required.set(f.patch,'wallNoSlip');
  if(val('meshMotion')==='ami'){required.set('rotorAMI','cyclicAMI');required.set('statorAMI','cyclicAMI');}
  return required;
}
function syncVisualPatches(addMissing=false){
  const required=meshPatchRequirements(),sources=meshPatchRequirements(true),existing=new Set(getPatches().map(p=>p.name)),compressible=cfg().compressible;
  // Disabling dictionary output must not delete explicitly registered conditions.
  // Only remove a managed row when its source patch has actually disappeared.
  for(const name of managedPatchNames)if(!sources.has(name)){patchRow(name)?.remove();managedPatchNames.delete(name);}
  if(addMissing)for(const [name,purpose] of required)if(!existing.has(name)){
    const p=patchDefaults(name,purpose);if(purpose==='velocityInlet')p.U=p.normal=blockMeshInletDirection(name);
    if(compressible&&purpose==='pressureOutlet')p.p='101325';
    addPatch(p);managedPatchNames.add(name);
  }
}
function assignVisualPatch(){
  const fs=selectedFaces(),name=val('visualPatchName').trim();
  if(!fs.length){visualPatchStatus('STLの面を選択してから割り当ててください。',true);return;}
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)){visualPatchStatus('パッチ名は半角英字・数字・_で指定し、数字から始めないでください。',true);return;}
  if(blockMeshGroupedPatches().some(p=>p.name===name)){visualPatchStatus(`${name} は背景メッシュで使用中です。STL側は ${name}_stl などの別名にするか、9番で背景面の名前を変更してください。`,true);return;}
  if(['rotorAMI','statorAMI','rotorZone'].includes(name)){visualPatchStatus(`${name} は回転領域用の名前です。別のパッチ名を指定してください。`,true);return;}
  if(allFaces().some(f=>!fs.includes(f)&&f.patch===name&&!fs.some(s=>s.file===f.file))){visualPatchStatus(`${name} は別のSTLで使用中です。部品ごとに名前を分けてください。`,true);return;}
  if(new Set(fs.map(f=>f.file)).size>1){visualPatchStatus('パッチ割り当てはSTLごとに行ってください。',true);return;}
  const updating=!!patchRow(name);
  rememberGeometry();fs.forEach(f=>f.patch=name);
  const m=Geometry.measure(fs),scale=Number(val('stlScale'));
  upsertPatch({...patchDefaults(name,val('visualPurpose')),U:val('visualU'),Q:val('visualQ'),mdot:val('visualMdot'),p:val('visualP'),T:val('visualT'),alpha:val('visualAlpha'),area:fmt(m.area*scale*scale),normal:'('+m.normal.join(' ')+')'});
  managedPatchNames.add(name);generate();refreshViewer();
  visualPatchStatus(`${name} を ${fs.length} 三角形に割り当て、第4欄の境界パッチを${updating?'更新':'追加'}しました。入力した条件は0ディレクトリにも反映されます。`);
}
function setStatus(text){$('geometryStatus').textContent=text;}
function setFlow(axis){
  setBlockMeshPreset(axis);
  const v='('+['x','y','z'].map(a=>a===axis?1:0).join(' ')+')';
  // Direction changes edit registered conditions, but never recreate deleted rows.
  if(patchRow('inlet'))upsertPatch({name:'inlet',purpose:'velocityInlet',U:v,normal:v});
  generate();
}
function fitDomain(){
  const fs=allFaces();if(!fs.length)return;const b=Geometry.bounds(fs),scale=Number(val('stlScale'));const extent=Geometry.sub(b.max,b.min),floor=Math.max(...extent)*.2;
  const min=b.min.map((x,i)=>(x-Math.max(extent[i]*.2,floor*.1))*scale),max=b.max.map((x,i)=>(x+Math.max(extent[i]*.2,floor*.1))*scale);
  $('convertToMeters').value=1;$('boxMin').value='('+min.join(' ')+')';$('boxMax').value='('+max.join(' ')+')';$('locationInMesh').value='('+min.map((x,i)=>x+(max[i]-x)*.05).join(' ')+')';$('includeBlockMesh').checked=true;generate();setStatus('背景領域を設定しました。保持点は外部流れ用に箱の隅へ設定しています。内部流れでは流体側の点へ変更してください。');
}
function setFluidPoint(){const fs=selectedFaces();if(!fs.length)return;const scale=Number(val('stlScale')),m=Geometry.measure(fs),center=[0,0,0];let weight=0;for(const f of fs){const a=Geometry.measure([f]).area;weight+=a;for(let j=0;j<3;j++)center[j]+=a*(f.v[0][j]+f.v[1][j]+f.v[2][j])/3;}const p=center.map((x,j)=>x/weight*scale+m.normal[j]*num('fluidOffset'));$('locationInMesh').value='('+p.map(fmt).join(' ')+')';generate();setStatus('locationInMeshを設定しました。面の法線方向と、点が流体内部にあることを確認してください。');}
function geometryPatchNames(g){const p=geometryParts.get(g.file);return p?[...new Set(p.faces.map(f=>f.patch))]:[g.name];}
function meshingGeometries(){const gs=getGeometries();if(val('meshMotion')==='ami')gs.push({file:'rotorZone.stl',name:'rotorZone',type:'triSurfaceMesh',patchType:'wall',levelMin:val('rotorLevel'),levelMax:val('rotorLevel'),featureLevel:'0',layers:'0',zone:true});return gs;}
function geometryRegionEntries(g){if(g.zone)return '        regions { surface { name rotorZone; } }\n';if(!geometryParts.has(g.file))return '';return '        regions\n        {\n'+geometryPatchNames(g).map(n=>`            ${n} { name ${n}; }`).join('\n')+'\n        }\n';}
function surfaceRegionEntries(g){
  if(g.zone)return `            faceZone rotorZone;\n            cellZone rotorZone;\n            cellZoneInside inside;\n            faceType boundary;\n`;
  if(!geometryParts.has(g.file))return '';
  return '            regions\n            {\n'+geometryPatchNames(g).map(n=>`                ${n} { level (${g.levelMin} ${g.levelMax}); patchInfo { type ${purposeType(getPatches().find(p=>p.name===n)?.purpose||'wallNoSlip')}; } }`).join('\n')+'\n            }\n';
}
function updateWorkbenchStatus(){
  const mode=val('meshMotion'),s=cfg();
  if(viewer){const scale=Number(val('stlScale'))||1;syncViewerOverlays();viewer.setGuide(['ami','mrf'].includes(mode)?rotorSurface().map(f=>({...f,v:f.v.map(v=>v.map(x=>x/scale))})):[]);if(!viewer.gl)viewer.draw();}
  $('rotationControls').classList.toggle('hidden',!['mrf','ami','rigid'].includes(mode));$('refineControls').classList.toggle('hidden',mode!=='refine');
  const messages={static:'固定メッシュを生成します。',mrf:'円筒内のcellZoneとMRFPropertiesを生成します。メッシュ自体は動きません。回転壁はMRFが処理します。静止面はnonRotatingPatchesへ指定してください。',ami:'閉じた円筒STLでrotorZoneを作り、境界面をcyclicAMIの対へ変換します。円筒は回転部品を囲み、背景境界・静止物体と交差させないでください。生成後はAMIの面数・補間重みと回転後のメッシュ品質を確認してください。',rigid:'計算領域全体が回転します。回転部品だけを動かす場合はAMIを選択してください。壁の用途は移動壁を使用します。',refine:'interFoamのalpha.water界面に合わせて細分化・粗大化します。壁への適合やy+を自動設計する機能ではありません。snappyでできた非六面体セルなどは細分化できない場合があります。'};
  $('motionStatus').textContent=messages[mode]+(mode!=='static'?` 選択中: ${s.solver.id}。`:'');
  $('visualP').previousElementSibling.textContent=`圧力 ${s.pMode} [${s.compressible||s.vof?'Pa':'m²/s²'}]`;
  updateSelection();
}
function strictVector(s){const m=String(s).trim().match(/^\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)$/);return m&&m.slice(1).map(Number).every(Number.isFinite)?m.slice(1).map(Number):null;}
function insideRotor(v){const d=Geometry.sub(v,parseVec(val('rotationOrigin'),[0,0,0])),axis=normVec(val('rotationAxis')),h=Geometry.dot(d,axis);return Math.abs(h)<num('rotorLength')/2&&Geometry.dot(d,d)-h*h<num('rotorRadius')**2;}
function followsMesh(p){
  if(val('meshMotion')==='rigid')return true;
  if(val('meshMotion')!=='ami')return false;
  if(motionPatchCache.has(p.name))return motionPatchCache.get(p.name);
  const faces=allFaces().filter(f=>f.patch===p.name),scale=Number(val('stlScale'));
  const follows=!!faces.length&&faces.every(f=>f.v.every(v=>insideRotor(v.map(x=>x*scale))));motionPatchCache.set(p.name,follows);return follows;
}
function blockingErrors(){
  const errs=[],c=cfg(),mode=val('meshMotion'),word=/^[A-Za-z_][A-Za-z0-9_]*$/;
  if(c.solver.id==='chtMultiRegionFoam')errs.push('CHTは領域ごとの物性と熱連成境界が未対応です。');
  if(c.solver.id==='icoFoam'&&val('turbulenceType')!=='laminar')errs.push('icoFoamはlaminarを選択してください。');
  if(c.solver.time==='steady'&&val('turbulenceType')==='LES')errs.push('LES/DESには非定常ソルバーを選択してください。');
  if(c.solver.time==='transient'&&val('ddtScheme')==='steadyState')errs.push('非定常ソルバーでsteadyState時間離散は使用できません。');
  if(val('turbulenceType')==='RAS'&&!rasModels.includes(val('rasModel')))errs.push('選択したRASモデルには未対応です。');
  if(val('turbulenceType')==='LES'&&!lesModels.includes(val('lesModel')))errs.push('選択したLESモデルには未対応です。');
  if(materials[val('material')]?.kind==='solid'||materials[val('material2')]?.kind==='solid'&&c.vof)errs.push('流体に固体材料は使用できません。');
  if(c.compressible&&materials[val('material')]?.kind!=='gas')errs.push('圧縮性ケースは現在perfectGasに対応しています。気体材料を選択してください。');
  for(const id of ['rho','nu','mu','Cp','Pr','TRef','deltaT','endTime','stlScale','convertToMeters'])if($(id)&&(!Number.isFinite(Number(val(id)))||Number(val(id))<=0))errs.push(`${id} は正の有限値が必要です。`);
  if(!Number.isInteger(num('nProc'))||num('nProc')<1)errs.push('並列数は1以上の整数にしてください。');
  if(val('decompMethod')!=='scotch'&&parseVec(val('simpleN')).reduce((a,b)=>a*b,1)!==num('nProc'))errs.push('分割数の積を並列数に合わせてください。');
  const patches=c.patches,names=patches.map(p=>p.name);
  if(new Set(names).size!==names.length)errs.push('境界条件表のパッチ名が重複しています。');
  for(const p of patches){if(!word.test(p.name))errs.push(`不正なパッチ名: ${p.name}`);if(!strictVector(p.U)||!strictVector(p.normal))errs.push(`${p.name}: U/normalは (x y z) の有限値が必要です。`);for(const k of ['p','Q','mdot','T','alpha','area'])if(p[k]===''||!Number.isFinite(Number(p[k])))errs.push(`${p.name}: ${k}が数値ではありません。`);if(Number(p.alpha)<0||Number(p.alpha)>1)errs.push(`${p.name}: 相分率は0〜1です。`);if(Number(p.T)<=0)errs.push(`${p.name}: 温度は絶対温度Kです。`);if(c.compressible&&['pressureOutlet','pressureInlet','totalPressureInlet','atmosphere'].includes(p.purpose)&&Number(p.p)<=0)errs.push(`${p.name}: 圧縮性の圧力は正の絶対圧[Pa]にしてください。`);if(['cyclic','cyclicAMI'].includes(p.purpose)&&!(mode==='ami'&&['rotorAMI','statorAMI'].includes(p.name)))errs.push(`${p.name}: 任意の周期境界ペアは未対応です。回転には上部のAMI方式を使用してください。`);}
  const required=autoFieldKeys(c),fields=currentFields();for(const k of required)if(!fields.includes(k))errs.push(`必須場 ${allFieldTemplates[k].object} を戻してください。`);
  const objects=fields.map(k=>allFieldTemplates[k]?.object);if(new Set(objects).size!==objects.length)errs.push('同じ物理量を異なる次元で二重に出力できません。自動場を復元してください。');
  const lo=strictVector(val('boxMin')),hi=strictVector(val('boxMax')),point=strictVector(val('locationInMesh')),scale=num('convertToMeters');
  if(checked('includeBlockMesh')){if(!lo||!hi||lo.some((x,i)=>x>=hi[i]))errs.push('背景領域のboxMin < boxMaxを各方向で満たしてください。');const cells=val('blockCells').trim().split(/\s+/).map(Number);if(cells.length!==3||cells.some(n=>!Number.isInteger(n)||n<1))errs.push('block cellsは3個の正の整数です。');for(const g of blockMeshGroupedPatches()){if(!word.test(g.name)||g.typeConflict)errs.push('背景面の名前・型が不正または不一致です。');const p=patches.find(p=>p.name===g.name);if(p&&purposeType(p.purpose)!==g.type)errs.push(`${g.name}: 背景面の型 ${g.type} と境界用途が一致しません。`);}}
  if(checked('includeSnappy')){
    if(!point)errs.push('locationInMeshは (x y z) [m] で指定してください。');
    if(point&&lo&&hi&&checked('includeBlockMesh')&&point.some((x,i)=>x<=lo[i]*scale||x>=hi[i]*scale))errs.push('locationInMeshを背景領域の内部へ置いてください。');
    const geoms=getGeometries();if(!geoms.length)errs.push('STLを読み込んでください。');
    if(new Set(geoms.map(g=>g.name)).size!==geoms.length)errs.push('形状名が重複しています。');
    for(const g of geoms){if(!geometryParts.has(g.file))errs.push(`${g.file}: STLを読み込んでください。`);if(!word.test(g.name)||!/^[A-Za-z_][A-Za-z0-9_]*\.stl$/.test(g.file))errs.push('形状名・STL名は英数字と_で指定してください。');if(g.type!=='triSurfaceMesh')errs.push('編集STLはtriSurfaceMeshを使用してください。');if(g.featureFile!==fileStem(g.file)+'.eMesh')errs.push(`${g.file}: eMesh名を ${fileStem(g.file)}.eMesh に合わせてください。`);for(const key of ['levelMin','levelMax','featureLevel','layers'])if(!/^\d+$/.test(g[key])||Number(g[key])>12)errs.push(`${g.file}: ${key}は0〜12の整数です。`);if(Number(g.levelMin)>Number(g.levelMax))errs.push(`${g.file}: 最小細分化レベルが最大を超えています。`);}
    const owners=new Map();for(const [file,part] of geometryParts)for(const name of new Set(part.faces.map(f=>f.patch))){if(owners.has(name)&&owners.get(name)!==file)errs.push(`${name}: 別STLのパッチ名と重複しています。`);owners.set(name,file);if(!word.test(name))errs.push('STLパッチ名が不正です。');}
  }
  if(mode!=='static'){
    if(['mrf'].includes(mode)&&!['simpleFoam','pimpleFoam'].includes(c.solver.id))errs.push('MRFはsimpleFoam / pimpleFoamに対応しています。');
    if(['ami','rigid'].includes(mode)&&!['pimpleFoam','interFoam','interIsoFoam'].includes(c.solver.id))errs.push('回転メッシュはpimpleFoam / interFoam / interIsoFoamを選択してください。');
    if(mode==='refine'&&c.solver.id!=='interFoam')errs.push('界面適合細分化はinterFoamを選択してください。');
    if(['ami','rigid','mrf'].includes(mode)){if(!strictVector(val('rotationOrigin'))||!strictVector(val('rotationAxis'))||!magVector(val('rotationAxis')))errs.push('回転中心とゼロでない回転軸を指定してください。');if(!Number.isFinite(Number(val('rotationRPM'))))errs.push('回転速度[rpm]が不正です。');}
    if(['ami','mrf'].includes(mode)){if(num('rotorRadius')<=0||num('rotorLength')<=0)errs.push('回転円筒の半径・長さは正の数です。');if(!/^[0-8]$/.test(val('rotorLevel')))errs.push('AMI細分化レベルは0〜8です。');if(mode==='ami'&&!checked('includeSnappy'))errs.push('AMI円筒生成にはsnappyHexMeshを有効にしてください。');if(geometryParts.has('rotorZone.stl'))errs.push('rotorZone.stlは回転領域用の予約名です。');if(lo&&hi&&checked('includeBlockMesh')){const b=Geometry.bounds(rotorSurface());if(b.min.some((x,i)=>x<=lo[i]*scale||b.max[i]>=hi[i]*scale))errs.push('回転円筒を背景領域に完全に収めてください。');}}
    if(mode==='mrf')for(const n of listWords(val('nonRotatingPatches')))if(!names.includes(n))errs.push(`MRF静止パッチ ${n} が境界条件表にありません。`);
    if(mode==='refine'){if(!Number.isInteger(num('refineInterval'))||num('refineInterval')<1||!Number.isInteger(num('refineMax'))||num('refineMax')<1||!Number.isInteger(num('refineCells'))||num('refineCells')<1)errs.push('細分化間隔・レベル・セル数は正の整数です。');if(num('refineLower')<=0||num('refineLower')>=.5)errs.push('界面下限は0より大きく0.5未満です。');}
    if(mode==='ami')for(const part of geometryParts.values()){let inside=false,outside=false;for(const f of part.faces)for(const v of f.v){if(insideRotor(v.map(x=>x*Number(val('stlScale')))))inside=true;else outside=true;}if(inside&&outside)errs.push(`${part.file}: 回転円筒が部品を横切っています。回転部品を円筒内へ完全に収めてください。`);}
  }
  if(c.vof&&val('waterRegionMode')==='box'){const a=strictVector(val('waterBoxMin')),b=strictVector(val('waterBoxMax'));if(!a||!b||a.some((x,i)=>x>=b[i]))errs.push('VOF水領域の最小座標 < 最大座標を満たしてください。');}
  return [...new Set([...errs,...auxiliaryInputErrors(c)])];
}
function rotorSurface(){const axis=strictVector(val('rotationAxis'));return Geometry.cylinder(strictVector(val('rotationOrigin'))||[0,0,0],axis&&Math.hypot(...axis)>0?axis:[0,0,1],Math.max(num('rotorRadius'),1e-12),Math.max(num('rotorLength'),1e-12));}
function rotationCoeffs(){return `origin ${val('rotationOrigin')};\n        axis (${normVec(val('rotationAxis')).join(' ')});\n        omega ${fmt(num('rotationRPM')*2*Math.PI/60)}; // rad/s, converted from rpm\n`;}
function motionFiles(c){
  const root=c.caseName,mode=val('meshMotion'),files=[];
  const add=(path,body)=>files.push({path:root+'/'+path,text:header('dictionary',path.split('/').pop(),path.split('/')[0])+body});
  if(['ami','rigid'].includes(mode))add('constant/dynamicMeshDict',`dynamicFvMesh dynamicMotionSolverFvMesh;\nmotionSolverLibs (fvMotionSolvers);\nmotionSolver solidBody;\n${mode==='ami'?'cellZone rotorZone;\n':''}solidBodyMotionFunction rotatingMotion;\n${rotationCoeffs()}`);
  if(mode==='ami'){
    files.push({path:root+'/constant/triSurface/rotorZone.stl',text:Geometry.exportSTL(rotorSurface())});
    add('system/createPatchDict',`pointSync false;\npatches\n(\n    {\n        name rotorAMI;\n        patchInfo { type cyclicAMI; neighbourPatch statorAMI; transform noOrdering; }\n        constructFrom patches;\n        patches (rotorZone);\n    }\n    {\n        name statorAMI;\n        patchInfo { type cyclicAMI; neighbourPatch rotorAMI; transform noOrdering; }\n        constructFrom patches;\n        patches (rotorZone_slave);\n    }\n);\n`);
  }
  if(mode==='mrf'){
    const o=parseVec(val('rotationOrigin')),a=normVec(val('rotationAxis')),h=num('rotorLength')/2,p1=o.map((x,i)=>x-h*a[i]),p2=o.map((x,i)=>x+h*a[i]);
    add('system/topoSetDict',`actions\n(\n    { name rotorCells; type cellSet; action new; source cylinderToCell; point1 (${p1.join(' ')}); point2 (${p2.join(' ')}); radius ${val('rotorRadius')}; }\n    { name rotorZone; type cellZoneSet; action new; source setToCellZone; set rotorCells; }\n);\n`);
    add('constant/MRFProperties',`rotor\n{\n    active yes;\n    cellZone rotorZone;\n    nonRotatingPatches (${listWords(val('nonRotatingPatches')).join(' ')});\n    ${rotationCoeffs()}}\n`);
  }
  if(mode==='refine')add('constant/dynamicMeshDict',`dynamicFvMesh dynamicRefineFvMesh;\ndynamicRefineFvMeshCoeffs\n{\n    refineInterval ${val('refineInterval')};\n    field alpha.water;\n    lowerRefineLevel ${val('refineLower')};\n    upperRefineLevel ${fmt(1-num('refineLower'))};\n    unrefineLevel 10;\n    nBufferLayers 1;\n    maxRefinement ${val('refineMax')};\n    maxCells ${val('refineCells')};\n    correctFluxes\n    (\n        (phi U)\n        (rhoPhi none)\n        (alphaPhi0.water none)\n        (nHatf none)\n        (ghf none)\n    );\n    dumpLevel true;\n}\n`);
  return files;
}
function buildAllrun(c){
  const mode=val('meshMotion'),commands=[];
  if(checked('includeBlockMesh'))commands.push('runApplication blockMesh');else commands.push('test -f constant/polyMesh/points || { echo "Existing constant/polyMesh is required" >&2; exit 1; }');
  if(checked('includeSnappy'))commands.push('runApplication surfaceFeatureExtract','runApplication snappyHexMesh -overwrite');
  if(mode==='ami')commands.push('runApplication createPatch -overwrite');
  if(mode==='mrf')commands.push('runApplication topoSet');
  commands.push('runApplication checkMesh -allTopology -allGeometry');
  if(c.vof)commands.push('runApplication setFields');
  if(num('nProc')>1)commands.push('runApplication decomposePar',`runParallel -np ${val('nProc')} ${c.solver.id}`,'runApplication reconstructPar');else commands.push(`runApplication ${c.solver.id}`);
  return `#!/bin/sh\nset -e\ncd "\${0%/*}" || exit 1\n. "\${WM_PROJECT_DIR:?Source OpenFOAM v2412 first}/bin/tools/RunFunctions"\n[ "\${WM_PROJECT_VERSION:-}" = v2412 ] || { echo "OpenFOAM v2412 is required" >&2; exit 1; }\n${commands.join('\n')}\ntouch ${c.caseName}.foam\n`;
}
function caseGuide(c){return auxiliaryGuide(c)+`# Visual setup notes\n\nSTL coordinates have been converted to metres once at export. Hidden faces remain in the exported geometry. Register the mesh boundary regions in the boundary-condition table before using the case.\n\nMesh mode: ${val('meshMotion')}.\n${val('meshMotion')==='ami'?'The generated cylinder must be closed, enclose the moving part, and avoid stationary walls. Check rotorZone cell membership, nonzero rotorAMI/statorAMI face counts, and AMI weights before trusting results.\n':''}Generated dictionaries have automated regression coverage; no OpenFOAM solver has been run by this tool. Run surfaceCheck on imported geometry, inspect the retained fluid region, run checkMesh, and check conservation and mesh/time-step sensitivity.\n\nFor an internal nozzle, the inlet face must bound the retained fluid cells. An isolated sheet inside a connected fluid volume is not automatically a one-sided inlet. Close the nozzle solid (including its cap), hide outer faces in the viewer, then assign the cap.\n\nUse movingWall for walls following mesh motion. Rigid mode rotates the entire domain. MRF keeps the mesh fixed.\n\nCHT region coupling, arbitrary cyclic pairs, overset and six-DoF are not configured by this version.\n\n---\n\n`;}
function projectSnapshot(){const inputs={};document.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{if(!['file'].includes(el.type)&&!['previewText','previewSelect','applicationMirror','fieldAddSelect'].includes(el.id))inputs[el.id]=el.type==='checkbox'?el.checked:el.value;});const data={format:'OpenFOAM-Case-Builder',version:3,auxiliary:auxiliaryProjectData(),inputs,patches:getPatches(),geometries:getGeometries(),parts:[...geometryParts.values()].map(p=>({file:p.file,originalName:p.originalName,faces:p.faces.map(f=>({v:f.v,region:f.region,patch:f.patch,hidden:f.hidden}))})),manualFields};return data;}
function saveProject(){if(auxiliaryBusy){setStatus('CSV / 初期水領域STLの読み込み完了を待ってください。');return;}const data=projectSnapshot();saveBlob(new Blob([JSON.stringify(data)],{type:'application/json'}),sanitizeCaseName(val('caseName'))+'.project.json');}
function restoreProject(data){
  if(data?.format!=='OpenFOAM-Case-Builder'||![1,2,3].includes(data.version)||!Array.isArray(data.parts)||!Array.isArray(data.patches)||!Array.isArray(data.geometries))throw Error('対応する作業ファイルではありません。');
  if(data.parts.reduce((n,p)=>n+(p.faces?.length||0),0)>750000)throw Error('作業ファイルの三角形数が上限を超えています。');
  const auxiliaryStaged=stageAuxiliaryProject(data);
  const staged=new Map();for(const p of data.parts){if(!/^[A-Za-z_][A-Za-z0-9_]*\.stl$/.test(p.file)||staged.has(p.file))throw Error('作業ファイルのSTL名が不正です。');const faces=p.faces.map(f=>({...Geometry.triangle(f.v,f.region),patch:Geometry.word(f.patch),hidden:!!f.hidden,file:p.file}));staged.set(p.file,{file:p.file,originalName:p.originalName,faces,topology:Geometry.topology(faces)});}
  for(const [id,value] of Object.entries({showBackgroundMesh:true,...auxiliaryProjectInputs(data)})){const el=$(id);if(!el||el.type==='file'||!el.matches('input,select,textarea')||['previewText','previewSelect','applicationMirror'].includes(id))continue;if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);}
  if(!solverDb.some(s=>s.id===val('solver')))$('solver').value='pimpleFoam';applySolverDefaults(val('solver'));
  $('patchTable').querySelector('tbody').innerHTML='';data.patches.forEach(p=>addPatch({...patchDefaults('patch'),...p}));
  $('geometryTable').querySelector('tbody').innerHTML='';data.geometries.forEach(addGeometry);geometryParts.clear();selectedGeometryFiles.clear();for(const [name,p] of staged){geometryParts.set(name,p);selectedGeometryFiles.set(name,true);}
  manualFields=Array.isArray(data.manualFields)?data.manualFields.filter(k=>Object.hasOwn(allFieldTemplates,k)):null;managedPatchNames=new Set(getPatches().map(p=>p.name).filter(name=>meshPatchRequirements(true).has(name)));geometryHistory.length=0;applyAuxiliaryProject(auxiliaryStaged);refreshViewer(true);generate();clearVisualPatchStatus();setStatus('作業を復元しました。');
}
function demoGeometry(){
  if(geometryParts.size){setStatus('デモを追加する前に作業を保存し、形状一覧の初期化で既存形状を解除してください。');return;}
  const cube=(min,max,base)=>{const v=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(a=>a.map((x,i)=>x?max[i]:min[i]));const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]];return faces.flatMap((q,i)=>[Geometry.triangle([v[q[0]],v[q[1]],v[q[2]]],base+'_'+i),Geometry.triangle([v[q[0]],v[q[2]],v[q[3]]],base+'_'+i)]);};
  $('geometryTable').querySelector('tbody').innerHTML='';for(const [name,fs] of [['tank',cube([-1,-1,-1],[1,1,1],'tank')],['nozzle',cube([-.15,-.15,-.6],[.15,.15,.2],'nozzle')]]){const file=name+'.stl';fs.forEach(f=>{f.file=file;f.patch=f.region;});geometryParts.set(file,{file,faces:fs,originalName:file,topology:Geometry.topology(fs)});selectedGeometryFiles.set(file,true);addGeometry(defaultGeometry(file));}
  $('stlScale').value='1';$('includeSnappy').checked=true;$('includeBlockMesh').checked=true;fitDomain();$('locationInMesh').value='(0.5 0 0)';refreshViewer(true);generate();setStatus('外側のtankを非表示にして内部のnozzleを選べます。nozzle上面を入口へ割り当ててください。');
}
function initWorkbench(){
  const picker=$('geometryFilesPicker');$('stlPickerSlot').append(picker.parentElement);
  $('visualPurpose').innerHTML=patchPurposes.filter(([k])=>!['cyclic','cyclicAMI','wedge','empty','symmetry','interface'].includes(k)).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
  viewer=new STLViewer($('stlCanvas'),pickFace,{onPointViewChange:updateFluidPointStatus,onDomainViewChange:updateBackgroundMeshStatus});syncViewerOverlays();viewer.setFaces([],true);workbenchReady=true;
  const bind=(id,fn)=>$(id).addEventListener('click',fn);
  for(const axis of ['X','Y','Z','Iso'])bind('view'+axis,()=>viewer.view(axis.toLowerCase()));
  bind('fitGeometry',()=>refreshViewer(true));bind('assignVisualPatch',assignVisualPatch);bind('demoGeometry',demoGeometry);
  document.querySelectorAll('input[id^="visual"],select[id^="visual"]').forEach(el=>el.addEventListener('input',clearVisualPatchStatus));
  bind('hideSelection',()=>{rememberGeometry();selectedFaces().forEach(f=>{f.hidden=true;f.selected=false;});refreshViewer();});
  bind('isolateSelection',()=>{rememberGeometry();allFaces().forEach(f=>f.hidden=!f.selected);refreshViewer();});
  bind('showAllFaces',()=>{rememberGeometry();allFaces().forEach(f=>f.hidden=false);refreshViewer();});
  bind('clearSelection',()=>{allFaces().forEach(f=>f.selected=false);refreshViewer();});
  bind('undoGeometry',()=>{const state=geometryHistory.pop();if(state){allFaces().forEach((f,i)=>Object.assign(f,state.faces[i]));$('patchTable').querySelector('tbody').replaceChildren();state.patches.forEach(addPatch);}generate();refreshViewer();});
  bind('fitDomain',fitDomain);bind('setFluidPoint',setFluidPoint);for(const a of ['X','Y','Z'])bind('flow'+a,()=>setFlow(a.toLowerCase()));
  bind('saveProject',saveProject);bind('loadProject',()=>$('projectPicker').click());$('projectPicker').addEventListener('change',async e=>{try{const file=e.target.files[0];if(file){if(file.size>200*1024*1024)throw Error('作業ファイルが大きすぎます。');restoreProject(JSON.parse(await file.text()));}}catch(err){setStatus('作業を開けません: '+err.message);}e.target.value='';});
  $('stlScale').addEventListener('change',()=>{updateSelection();generate();});
  // Make original labels accessible without changing their contextual help.
  document.querySelectorAll('label').forEach(label=>{const next=label.nextElementSibling;if(next?.id&&next.matches('input,select,textarea'))label.htmlFor=next.id;});
  $('solverInfo').insertAdjacentHTML('afterend','<p class="hint">CHTの領域連成、応力輸送型乱流モデル、v2fは必要場の生成が未対応のため選択対象外です。</p>');
  generate();
}
