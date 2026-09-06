const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {app}=require('./helpers.cjs');
function visible(a,id){let el=a.d.getElementById(id);assert.ok(el,id+' exists');while(el){assert.equal(el.hidden,false,id+' has no hidden ancestor');assert.notEqual(a.w.getComputedStyle(el).display,'none',id+' is displayed');el=el.parentElement;}}
async function chooseFile(a,id,file){const el=a.d.getElementById(id);Object.defineProperty(el,'files',{configurable:true,value:[file]});el.dispatchEvent(new a.w.Event('change',{bubbles:true}));await new Promise(setImmediate);}
test('both upload inputs are visible on initial load and linked directly from the page header',()=>{const a=app();try{
  assert.match(a.d.title,/v8\.3$/);assert.equal(a.d.getElementById('enableAcceleration').checked,false);assert.equal(a.d.getElementById('waterRegionMode').value,'box');
  visible(a,'accelerationPicker');visible(a,'waterRegionPicker');
  for(const id of ['initialWaterPanel','accelerationPanel'])assert.ok(a.d.querySelector('nav a[href="#'+id+'"]'));
  assert.equal(fs.readFileSync(require.resolve('../OpenFOAM_v2412_case_builder_v8_3.html'),'utf8'),fs.readFileSync(require.resolve('../OpenFOAM_v2412_case_builder_v3.html'),'utf8'));
}finally{a.close();}});
test('choosing CSV in the visible file input enables acceleration and produces its source',async()=>{const a=app();try{
  a.set('includeSnappy',false);a.set('solver','interFoam');a.set('adjustTimeStep','no');
  const text='time,ax,ay,az\n0,0,0,0\n2,1,0,0';await chooseFile(a,'accelerationPicker',{name:'history.csv',size:text.length,text:async()=>text});
  assert.equal(a.d.getElementById('enableAcceleration').checked,true);assert.match(a.file('constant/fvOptions'),/tabulatedAccelerationSource/);assert.match(a.d.getElementById('accelerationStatus').textContent,/history.csv/);
  a.set('enableAcceleration',false);visible(a,'accelerationPicker');assert.equal(a.file('constant/fvOptions'),undefined);assert.equal(a.errors.length,0);
}finally{a.close();}});
test('choosing the initial-water file switches to STL while keeping meshing surfaces separate',async()=>{const a=app();try{
  a.set('includeSnappy',false);a.set('solver','interFoam');
  const G=a.api.Geometry,v=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]].map(ids=>G.triangle(ids.map(i=>v[i])));
  const bytes=new TextEncoder().encode(G.exportSTL(faces)),buffer=new a.w.ArrayBuffer(bytes.length);new a.w.Uint8Array(buffer).set(bytes);
  await chooseFile(a,'waterRegionPicker',{name:'fill.stl',size:bytes.length,arrayBuffer:async()=>buffer});
  assert.equal(a.d.getElementById('waterRegionMode').value,'stl');assert.match(a.file('system/setFieldsDict'),/searchableSurfaceToCell/);assert.ok(a.file('constant/triSurface/initialWater/water.stl'));assert.equal(a.api.geometryParts.size,0);visible(a,'waterRegionPreview');
  a.set('waterRegionMode','box');visible(a,'waterRegionPicker');assert.equal(a.file('constant/triSurface/initialWater/water.stl'),undefined);assert.equal(a.errors.length,0);
}finally{a.close();}});
