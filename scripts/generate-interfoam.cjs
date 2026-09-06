// All configuration and output, including observation dictionaries, comes from the HTML GUI.
const fs=require('fs'),path=require('path');
// Usage: node scripts/generate-interfoam.cjs CASE /path/to/output
const root=path.resolve(process.argv[3]||'interfoam-output');
fs.mkdirSync(path.join(root,'inputs'),{recursive:true});
if(!fs.existsSync(path.join(root,'inputs','container_acceleration.csv')))fs.copyFileSync(path.join(__dirname,'../examples/interfoam/container_acceleration.csv'),path.join(root,'inputs','container_acceleration.csv'));
if(!['damBreak_stl','damBreak_coarse','damBreak_amr','damBreak_amr_level2','sloshing_csv'].includes(process.argv[2]||'damBreak_stl'))throw Error('Unknown example');
const {app}=require('../tests/helpers.cjs');
const G=require('../src/geometry.js');
function cube(lo,hi){const v=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(a=>a.map((x,i)=>x?hi[i]:lo[i]));return [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]].flatMap(q=>[G.triangle([v[q[0]],v[q[1]],v[q[2]]],'initialWater'),G.triangle([v[q[0]],v[q[2]],v[q[3]]],'initialWater')]);}
function patch(name,purpose){return {name,purpose,U:'(0 0 0)',normal:'(1 0 0)',area:'1',Q:'0',mdot:'0',p:'0',T:'293.15',alpha:'0'};}
async function make(kind){const a=app();try{
const dam=kind.startsWith('damBreak'),amr=kind.includes('amr'),thin=amr||kind==='damBreak_coarse',name=kind,dest=path.join(root,name);if(fs.existsSync(dest))throw Error('Refusing overwrite '+dest);
const settings={caseName:name,solver:'interFoam',turbulenceType:'laminar',includeSnappy:false,includeBlockMesh:true,nProc:'1',meshMotion:amr?'refine':'static',refineInterval:'5',refineMax:kind.includes('level2')?'2':'1',refineCells:'100000',refineLower:'0.001',material:'water20',material2:'air20',initialU:'(0 0 0)',gVec:'(0 0 -9.81)',deltaT:'0.0001',adjustTimeStep:'yes',maxDeltaT:dam?'0.002':'0.005',maxCo:'0.3',maxAlphaCo:'0.15',endTime:dam?'1':'50',writeControl:'adjustableRunTime',writeInterval:dam?'0.05':'0.1',writePrecision:'10',divUScheme:'bounded Gauss limitedLinearV 1',nOuter:'2',nCorrectors:'2',foSurfaceFieldValue:false,foResiduals:true,foCourant:true,foWallShear:false,foWallSamples:!dam,foInterfaceHeight:true,foHeightDirection:'(0 0 -1)',foHeightInterval:'0.01',foVolFieldValue:true,foVFVRegion:'all',foVFVOperation:'volIntegrate',foVFVFields:'alpha.water',foBasicWriteControl:'runTime',foBasicWriteInterval:'0.01',foResidualMode:'auto',waterRegionMode:'stl',waterRegionScale:'1'};
for(const [k,v]of Object.entries(settings))a.set(k,v);
let patches;
if(dam){
for(const [k,v]of Object.entries({boxMin:'(0 0 0)',boxMax:'(0.584 0.0146 0.584)',blockCells:thin?'40 2 40':'80 1 80',bmXMinusName:'leftWall',bmXMinusType:'wall',bmXPlusName:'rightWall',bmXPlusType:'wall',bmYMinusName:'frontAndBack',bmYMinusType:thin?'symmetry':'empty',bmYPlusName:'frontAndBack',bmYPlusType:thin?'symmetry':'empty',bmZMinusName:'bottom',bmZMinusType:'wall',bmZPlusName:'atmosphere',bmZPlusType:'patch',foHeightLocations:'(0.01 0.0073 0.000001)\n(0.57 0.0073 0.000001)'}))a.set(k,v);
patches=[patch('leftWall','wallNoSlip'),patch('rightWall','wallNoSlip'),patch('bottom','wallNoSlip'),patch('atmosphere','atmosphere'),patch('frontAndBack',thin?'symmetry':'empty')];}
else{
for(const [k,v]of Object.entries({boxMin:'(0 0 0)',boxMax:'(1.2 0.8 3)',blockCells:'24 16 60',bmXMinusName:'shortWall_x0',bmXMinusType:'wall',bmXPlusName:'shortWall_xL',bmXPlusType:'wall',bmYMinusName:'longWall_y0',bmYMinusType:'wall',bmYPlusName:'longWall_yW',bmYPlusType:'wall',bmZMinusName:'bottom',bmZMinusType:'wall',bmZPlusName:'atmosphere',bmZPlusType:'patch'}))a.set(k,v);
patches=['shortWall_x0','shortWall_xL','longWall_y0','longWall_yW','bottom'].map(n=>patch(n,'wallNoSlip'));patches.push(patch('atmosphere','atmosphere'));
}
const snap=JSON.parse(JSON.stringify(a.api.projectSnapshot()));snap.patches=patches;a.api.restoreProject(snap);
const faces=cube([0,0,0],dam?[.1461,.0146,.292]:[1.2,.8,1.2]);const stl=G.exportSTL(faces,1);fs.writeFileSync(path.join(root,'inputs',kind+'_initial_water.stl'),stl);const bytes=new TextEncoder().encode(stl);
await a.api.importWaterRegionFile({name:kind+'_initial_water.stl',size:bytes.length,arrayBuffer:async()=>{const b=new a.w.ArrayBuffer(bytes.length);new a.w.Uint8Array(b).set(bytes);return b}});
if(!dam){const csvPath=path.join(root,'inputs','container_acceleration.csv');const csv=fs.readFileSync(csvPath,'utf8');a.set('accelerationConvention',process.env.ACCELERATION_CONVENTION||'container');a.set('accelerationTail','zero');a.set('accelerationTailStep','0.01');a.set('foWallSamplePatches','shortWall_x0 shortWall_xL');a.set('foHeightLocations','(0.005 0.007 0.025)\n(1.195 0.007 0.025)\n(0.005 0.793 0.025)\n(1.195 0.793 0.025)');a.set('enableAcceleration',true);a.set('accelerationUnit','m/s2');await a.api.importAccelerationFile({name:'container_acceleration.csv',size:Buffer.byteLength(csv),text:async()=>csv});}
a.click('generateBtn');const errors=[...a.api.blockingErrors()];if(errors.length)throw Error(errors.join('\n'));
for(const o of a.api.outputs()){const p=path.join(root,o.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,o.text);}
fs.writeFileSync(path.join(dest,name+'.project.json'),JSON.stringify(a.api.projectSnapshot(),null,2));
console.log('Generated',dest, 'STL selection:',a.file('system/setFieldsDict'));
}finally{a.close();}}
make(process.argv[2]||'damBreak_stl').catch(e=>{console.error(e);process.exitCode=1});
