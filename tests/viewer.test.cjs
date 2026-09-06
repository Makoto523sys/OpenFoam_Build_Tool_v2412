const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Geometry=require('../src/geometry.js');

// Record the WebGL API contract. This does not compile shaders or verify rendered pixels.
function recordingGL(){
  const gl={calls:[],uniforms:{},depth:true,writesDepth:true,attributes:{},buffers:[],shaders:[]};
  for(const key of ['ARRAY_BUFFER','STATIC_DRAW','DYNAMIC_DRAW','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ALIASED_POINT_SIZE_RANGE','DEPTH_TEST','FLOAT','TRIANGLES','LINES','POINTS'])gl[key]=key;
  gl.COLOR_BUFFER_BIT=1;gl.DEPTH_BUFFER_BIT=2;
  for(const name of ['compileShader','attachShader','linkProgram','viewport','clearColor','clear','enableVertexAttribArray','disableVertexAttribArray','vertexAttrib4f','useProgram'])gl[name]=()=>{};
  gl.createShader=()=>{const shader={};gl.shaders.push(shader);return shader;};gl.shaderSource=(shader,code)=>{shader.code=code;};
  gl.getShaderParameter=gl.getProgramParameter=()=>true;gl.createProgram=()=>({});
  gl.getParameter=()=>[1,64];gl.getAttribLocation=(_,name)=>name;gl.getUniformLocation=(_,name)=>name;
  gl.createBuffer=()=>{const buffer={};gl.buffers.push(buffer);return buffer;};
  gl.bindBuffer=(_,buffer)=>{gl.bound=buffer;};gl.bufferData=(_,data)=>{gl.bound.data=Array.from(data);};
  gl.vertexAttribPointer=name=>{gl.attributes[name]=gl.bound;};
  gl.uniform1f=(name,value)=>{gl.uniforms[name]=value;};gl.uniformMatrix4fv=(name,_,value)=>{gl.uniforms[name]=Array.from(value);};
  gl.enable=()=>{gl.depth=true;};gl.disable=()=>{gl.depth=false;};gl.depthMask=value=>{gl.writesDepth=value;};
  gl.drawArrays=(mode,first,count)=>gl.calls.push({mode,first,count,positions:[...gl.attributes.pos.data],depth:gl.depth,writesDepth:gl.writesDepth,pass:gl.uniforms.markerPass,size:gl.uniforms.pointSize});
  return gl;
}
function fixture(width=640,height=480){
  const gl=recordingGL(),events={},states=[],canvas={clientWidth:width,clientHeight:height,getContext:()=>gl,addEventListener:(name,fn)=>{events[name]=fn;},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0})};
  const Viewer=vm.runInNewContext(fs.readFileSync(require.resolve('../src/viewer.js'),'utf8')+'; STLViewer',{Geometry,window:{devicePixelRatio:2},document:{getElementById:()=>null},ResizeObserver:class{observe(){}}});
  const picks=[],viewer=new Viewer(canvas,f=>picks.push(f),{onPointViewChange:state=>states.push(state)});
  const face=Geometry.triangle([[-1,-1,0],[1,-1,0],[0,1,0]]);
  viewer.setFaces([face],true);gl.calls.length=0;
  return {viewer,gl,canvas,events,states,picks,face};
}

test('marker updates replace one position; depth-aware centre and through-surface outline preserve mesh picking',()=>{
  const {viewer,gl,face,picks}=fixture();viewer.view('z');
  for(const point of [[0,0,-.5],[.25,0,.5]]){
    gl.calls.length=0;viewer.setPoint(point);
    const calls=gl.calls.filter(c=>c.mode==='POINTS');
    assert.equal(calls.length,2);for(const call of calls){assert.equal(call.count,1);assert.deepEqual(call.positions,point);assert.equal(call.writesDepth,false);assert.equal(call.size,44);}
    assert.equal(calls[0].depth,false);assert.equal(calls[1].depth,true);assert.equal(gl.depth,true);assert.equal(gl.writesDepth,true);
    viewer.pick(320,240,false);assert.equal(picks.at(-1),face,'marker is never selectable as a mesh face');
  }
  gl.calls.length=0;viewer.setPoint(null);assert.equal(gl.calls.filter(c=>c.mode==='POINTS').length,0);
  viewer.setPoint([1,2,Infinity]);assert.equal(viewer.point,null);
  viewer.setPoint([1e100,0,0]);assert.equal(viewer.point,null,'unrepresentable GPU coordinates must not leave a stale marker');
  viewer.setPoint([0,0,0]);gl.calls.length=0;viewer.setFaces([],true);
  assert.equal(gl.calls.filter(c=>c.mode==='POINTS').length,0,'no marker on an empty STL scene');
});

test('moving a point preserves the camera; whole-scene fit and Home frame it in narrow viewports',()=>{
  const {viewer,events,face}=fixture(300,480);
  viewer.view('z');const center=Array.from(viewer.center),radius=viewer.radius,zoom=viewer.zoom;
  viewer.setPoint([50,-30,20]);
  assert.deepEqual(Array.from(viewer.center),center);assert.equal(viewer.radius,radius);assert.equal(viewer.zoom,zoom);assert.equal(viewer.pointViewState(),'offscreen');
  events.keydown({key:'Home',preventDefault(){}});
  for(const axis of ['x','y','z','iso']){
    viewer.view(axis);assert.equal(viewer.pointViewState(),'onscreen');
    for(const v of [...face.v,viewer.point])assert.ok(viewer.project(v).every(x=>Math.abs(x)<1),'STL and point are both inside the view');
  }
  const p=viewer.project(viewer.point);viewer.pan=[.1,-.2];const q=viewer.project(viewer.point);
  assert.ok(Math.abs(q[0]-p[0]-.1)<1e-6);assert.ok(Math.abs(q[1]-p[1]+.2)<1e-6);
});

test('axis views preserve point depth and guides do not act as opaque surfaces',()=>{
  const {viewer,gl,face}=fixture();viewer.view('z');viewer.setPoint([0,0,50]);
  assert.equal(viewer.pointViewState(),'onscreen','depth-only motion must not clip the marker');
  assert.ok(viewer.project([0,0,50])[2]<viewer.project([0,0,0])[2]);
  gl.calls.length=0;viewer.setGuide([face]);
  const guide=gl.calls.find(c=>c.mode==='LINES');assert.equal(guide.writesDepth,false);
  face.hidden=true;viewer.recolor();assert.equal(viewer.pointViewState(),'onscreen');
  assert.equal(viewer.faces.length,1,'visibility operations keep the original geometry');
});

test('background outline has twelve distinct axis-aligned edges and never occludes or replaces selectable STL',()=>{
  const {viewer,gl,face,picks}=fixture();viewer.view('z');
  viewer.setDomain({min:[-2,-3,-4],max:[5,6,7]});
  const call=gl.calls.filter(c=>c.mode==='LINES').at(-1);
  assert.equal(call.count,24);assert.equal(call.depth,false);assert.equal(call.writesDepth,false);assert.equal(gl.depth,true);assert.equal(gl.writesDepth,true);
  const edges=new Set();
  for(let i=0;i<call.positions.length;i+=6){
    const a=call.positions.slice(i,i+3),b=call.positions.slice(i+3,i+6);
    assert.equal(a.filter((x,j)=>x!==b[j]).length,1,'edge must run along exactly one axis');
    for(const p of [a,b])p.forEach((x,j)=>assert.ok([[-2,5],[-3,6],[-4,7]][j].includes(x)));
    edges.add([a.join(','),b.join(',')].sort().join('|'));
  }
  assert.equal(edges.size,12);viewer.pick(320,240,false);assert.equal(picks.at(-1),face);
  viewer.setDomain({min:[10,20,30],max:[11,22,33]});assert.deepEqual(Array.from(viewer.domain.min),[10,20,30]);
  gl.calls.length=0;viewer.setDomain({min:[1,0,0],max:[1,2,3]});assert.equal(viewer.domain,null);assert.equal(gl.calls.filter(c=>c.mode==='LINES').length,0);
});

test('whole-scene fit includes the box, STL and point, and a background box can be drawn by itself',()=>{
  const {viewer,gl,events,face}=fixture(300,480);viewer.setPoint([200,0,0]);
  const camera={center:Array.from(viewer.center),radius:viewer.radius,zoom:viewer.zoom};
  viewer.setDomain({min:[-100,-20,-30],max:[50,40,60]});
  assert.deepEqual(Array.from(viewer.center),camera.center);assert.equal(viewer.radius,camera.radius);assert.equal(viewer.zoom,camera.zoom);assert.equal(viewer.domainViewState(),'clipped');
  events.keydown({key:'Home',preventDefault(){}});
  for(const axis of ['x','y','z','iso']){
    viewer.view(axis);assert.equal(viewer.domainViewState(),'onscreen');
    for(const p of [...face.v,viewer.point,...viewer.domainCorners])assert.ok(viewer.project(p).every(x=>Math.abs(x)<1));
  }
  gl.calls.length=0;viewer.setFaces([],true);assert.equal(viewer.domainViewState(),'onscreen');assert.equal(gl.calls.find(c=>c.mode==='LINES').count,24);
});
