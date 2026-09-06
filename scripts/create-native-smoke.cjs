// Generate small cases through the distributed HTML. Run separately in v2412.
const fs=require('node:fs'),path=require('node:path');
const {app}=require('../tests/helpers.cjs');
const G=require('../src/geometry.js');
const destination=path.resolve(process.argv[2]||'native-smoke');
function editPatch(a,name,key,value){const row=[...a.d.querySelectorAll('#patchTable tbody tr')].find(r=>r.querySelector('[data-k="name"]').value===name);if(!row)throw Error('Missing patch '+name);const el=row.querySelector(`[data-k="${key}"]`);el.value=value;el.dispatchEvent(new a.w.Event('input',{bubbles:true}));}
function quad(points,region){return [G.triangle(points.slice(0,3),region),G.triangle([points[0],points[2],points[3]],region)];}
async function stlCube(a){
  const surfaces={
    inlet:quad([[0,0,0],[0,0,1],[0,1,1],[0,1,0]],'inlet'),
    outlet:quad([[1,0,0],[1,1,0],[1,1,1],[1,0,1]],'outlet'),
    walls:[...quad([[0,0,0],[1,0,0],[1,0,1],[0,0,1]],'walls'),...quad([[0,1,0],[0,1,1],[1,1,1],[1,1,0]],'walls')],
    symmery:[...quad([[0,0,0],[0,1,0],[1,1,0],[1,0,0]],'symmery'),...quad([[0,0,1],[1,0,1],[1,1,1],[0,1,1]],'symmery')]
  };
  await a.api.importGeometryFiles(Object.entries(surfaces).map(([name,faces])=>{const bytes=new TextEncoder().encode(G.exportSTL(faces));return {name:name+'.stl',size:bytes.length,arrayBuffer:async()=>bytes.buffer};}));
  a.click('fitDomain');a.set('blockCells','14 14 14');a.set('locationInMesh','(0.5 0.5 0.5)');
  for(const row of a.d.querySelectorAll('#geometryTable tbody tr'))for(const key of ['levelMin','levelMax','featureLevel'])row.querySelector(`[data-g="${key}"]`).value='0';
  a.click('addMeshPatches');
  for(const [name,purpose] of [['inlet_inlet','velocityInlet'],['outlet_outlet','pressureOutlet'],['symmery_symmery','symmetry']])editPatch(a,name,'purpose',purpose);
  editPatch(a,'inlet_inlet','U','(1 0 0)');
}
async function create(name,solver,outer,stl=false){
  const target=path.join(destination,name);if(fs.existsSync(target))throw Error('Refusing to overwrite '+target);
  const a=app();try{
    a.set('caseName',name);a.set('includeSnappy',false);a.set('solver',solver);a.set('turbulenceType',solver==='icoFoam'?'laminar':'RAS');a.set('rasModel','kOmegaSST');
    a.set('boxMin','(0 0 0)');a.set('boxMax','(1 1 1)');a.set('blockCells','10 10 10');a.set('nProc','1');a.set('nOuter',String(outer));
    a.set('deltaT',solver==='simpleFoam'?'1':'0.001');a.set('endTime',solver==='simpleFoam'?'5':'0.005');a.set('adjustTimeStep','no');a.set('writeControl','timeStep');a.set('writeInterval','1');
    a.set('foYPlus',solver!=='icoFoam');a.set('foBasicWriteControl','timeStep');a.set('foBasicWriteInterval','1');a.set('foSFVMode','auto');
    if(stl)await stlCube(a);else a.click('addMeshPatches');
    if(solver==='interFoam'){a.set('gVec','(0 0 0)');a.set('waterBoxMin','(-0.1 -0.1 -0.1)');a.set('waterBoxMax','(1.1 1.1 1.1)');}
    a.click('generateBtn');const errors=[...a.api.blockingErrors()];if(errors.length)throw Error(name+': '+errors.join('\n'));
    fs.mkdirSync(target,{recursive:true});
    for(const output of a.api.outputs()){const file=path.join(destination,output.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,output.text);}
    for(const [file,part] of a.api.geometryParts){const output=path.join(target,'constant/triSurface',file);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,G.exportSTL(part.faces,1));}
    console.log('Generated '+target);
  }finally{a.close();}
}
(async()=>{for(const data of [['pimple-one','pimpleFoam',1],['pimple-three','pimpleFoam',3],['simple','simpleFoam',1],['piso','icoFoam',1],['vof','interFoam',1],['stl-channel','pimpleFoam',1,true]])await create(...data);})().catch(error=>{console.error(error);process.exitCode=1;});
