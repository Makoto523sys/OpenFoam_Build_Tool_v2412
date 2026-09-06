/* Dependency-free WebGL viewer, orthographic projection and depth-aware picking. */
class STLViewer {
  constructor(canvas,onPick,options={}) {
    this.compassId=options.compassId||'viewAxes';
    this.point=null;this.onPointViewChange=options.onPointViewChange;
    this.canvas=canvas;this.onPick=onPick;this.faces=[];this.yaw=-0.65;this.pitch=0.45;this.zoom=1;this.pan=[0,0];
    this.gl=canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});
    if(!this.gl){canvas.replaceWith(Object.assign(document.createElement('p'),{textContent:'WebGLを利用できません。3D表示にはブラウザのハードウェアアクセラレーションを有効にしてください。ファイルの読み込み・辞書生成は利用できます。'}));return;}
    const gl=this.gl;
    const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec3 pos; attribute vec4 color; uniform mat4 matrix; uniform float pointSize; varying vec4 c; void main(){gl_Position=matrix*vec4(pos,1.0);gl_PointSize=pointSize;c=color;}'));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec4 c; uniform float markerPass; void main(){if(c.a<0.5)discard;if(markerPass>0.5){float r=length(gl_PointCoord-vec2(0.5))*2.0;if(r>1.0)discard;if(markerPass<1.5&&r<0.68)discard;gl_FragColor=r>0.84?vec4(1.0):c;}else{gl_FragColor=c;}}'));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
    this.program=p;this.pb=gl.createBuffer();this.cb=gl.createBuffer();this.gb=gl.createBuffer();this.pos=gl.getAttribLocation(p,'pos');this.col=gl.getAttribLocation(p,'color');this.mat=gl.getUniformLocation(p,'matrix');
    this.pointBuffer=gl.createBuffer();this.pointSize=gl.getUniformLocation(p,'pointSize');this.markerPass=gl.getUniformLocation(p,'markerPass');this.maxPointSize=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')this.yaw-=.1;else if(e.key==='ArrowRight')this.yaw+=.1;else if(e.key==='ArrowUp')this.pitch-=.1;else if(e.key==='ArrowDown')this.pitch+=.1;else if(['+','='].includes(e.key))this.zoom=Math.min(100,this.zoom*1.15);else if(e.key==='-')this.zoom=Math.max(.05,this.zoom/1.15);else if(e.key==='Home'){this.setFaces(this.faces,true);}else return;e.preventDefault();this.draw();});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag.x=e.clientX;this.drag.y=e.clientY;if(this.drag.button===2){this.pan[0]+=2*dx/canvas.clientWidth;this.pan[1]-=2*dy/canvas.clientHeight;}else{this.yaw+=dx*.008;this.pitch+=dy*.008;}this.draw();});
    canvas.addEventListener('pointerup',e=>{const d=this.drag;this.drag=null;if(d&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<4&&d.button===0){const r=canvas.getBoundingClientRect();this.pick(e.clientX-r.left,e.clientY-r.top,e.ctrlKey||e.metaKey||e.shiftKey);}});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.05,Math.min(100,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();},{passive:false});
    canvas.addEventListener('pointercancel',()=>{this.drag=null;});
    new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  setFaces(faces,fit=false) {
    this.faces=faces;
    if(fit){const b=faces.length?Geometry.bounds(faces):{min:[-1,-1,-1],max:[1,1,1]};if(faces.length&&this.point)for(let i=0;i<3;i++){b.min[i]=Math.min(b.min[i],this.point[i]);b.max[i]=Math.max(b.max[i],this.point[i]);}this.center=b.min.map((x,i)=>(x+b.max[i])/2);this.radius=Math.max(Math.hypot(...Geometry.sub(b.max,b.min))/2,1e-8);this.zoom=this.fitZoom();this.pan=[0,0];}
    if(!this.gl){this.draw();return;}
    const pos=new Float32Array(faces.length*9);faces.forEach((f,i)=>pos.set(f.v.flat(),i*9));this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.pb);this.gl.bufferData(this.gl.ARRAY_BUFFER,pos,this.gl.STATIC_DRAW);this.recolor();
  }
  recolor() {
    if(!this.gl)return;const colors=new Float32Array(this.faces.length*12);
    this.faces.forEach((f,i)=>{let hash=0;for(const c of f.patch)hash=(hash*31+c.charCodeAt(0))>>>0;const base=[.28+(hash%97)/180,.4+((hash>>>8)%83)/190,.5+((hash>>>16)%71)/180];const shade=.6+.4*Math.abs(Geometry.dot(f.n,Geometry.unit([.3,.5,1])));const rgb=f.selected?[1,.72,.15]:base.map(x=>x*shade);for(let j=0;j<3;j++)colors.set([...rgb,f.hidden?0:1],i*12+j*4);});
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.cb);this.gl.bufferData(this.gl.ARRAY_BUFFER,colors,this.gl.DYNAMIC_DRAW);this.draw();
  }
  setGuide(faces){
    this.guideCount=faces.length*6;if(!this.gl)return;
    const vertices=new Float32Array(faces.length*18);faces.forEach((f,i)=>vertices.set([f.v[0],f.v[1],f.v[1],f.v[2],f.v[2],f.v[0]].flat(),i*18));
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.gb);this.gl.bufferData(this.gl.ARRAY_BUFFER,vertices,this.gl.STATIC_DRAW);this.draw();
  }
  setPoint(point,redraw=true){
    // One display-only point, in the same unscaled coordinates as this viewer's STL.
    this.point=point?.length===3&&point.every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x)))?[...point]:null;
    if(this.gl&&this.point){this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.pointBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(this.point),this.gl.DYNAMIC_DRAW);}
    if(redraw)this.draw();
  }
  fitZoom(){return Math.min(1,Math.max(1,this.canvas.clientWidth)/Math.max(1,this.canvas.clientHeight));}
  pointViewState(){
    if(!this.point)return 'unset';
    if(!this.faces.length)return 'empty';
    if(!this.gl)return 'unavailable';
    if(!this.canvas.clientWidth||!this.canvas.clientHeight)return 'hidden';
    return this.project(this.point).every(x=>Number.isFinite(x)&&Math.abs(x)<=1)?'onscreen':'offscreen';
  }
  matrix() {
    const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),c=this.center||[0,0,0],r=this.radius||1;
    const aspect=Math.max(1,this.canvas.clientWidth)/Math.max(1,this.canvas.clientHeight),s=.85*this.zoom/r;
    const a=[cy,0,sy],b=[sp*sy,cp,-sp*cy],z=[-cp*sy,sp,cp*cy];
    // Extend only the depth range when the point moves; preserve the user's framing.
    const depthRadius=this.point&&this.faces.length?Math.max(r,Math.hypot(...Geometry.sub(this.point,c))):r;
    return new Float32Array([a[0]*s/aspect,b[0]*s,-z[0]/(depthRadius*4),0,a[1]*s/aspect,b[1]*s,-z[1]/(depthRadius*4),0,a[2]*s/aspect,b[2]*s,-z[2]/(depthRadius*4),0,-Geometry.dot(a,c)*s/aspect+this.pan[0],-Geometry.dot(b,c)*s+this.pan[1],Geometry.dot(z,c)/(depthRadius*4),1]);
  }
  project(v,m=this.matrix()){return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];}
  draw() {
    this.onPointViewChange?.(this.pointViewState());
    if(!this.gl||!this.canvas.clientWidth||!this.canvas.clientHeight)return;const gl=this.gl,canvas=this.canvas,dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(canvas.clientWidth*dpr));canvas.height=Math.max(1,Math.round(canvas.clientHeight*dpr));
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.045,.075,.12,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(this.program);gl.uniformMatrix4fv(this.mat,false,this.matrix());gl.uniform1f(this.markerPass,0);gl.uniform1f(this.pointSize,1);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.pb);gl.enableVertexAttribArray(this.pos);gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.cb);gl.enableVertexAttribArray(this.col);gl.vertexAttribPointer(this.col,4,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,this.faces.length*3);
    if(this.guideCount){gl.bindBuffer(gl.ARRAY_BUFFER,this.gb);gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,0,0);gl.disableVertexAttribArray(this.col);gl.vertexAttrib4f(this.col,.1,.9,.85,1);gl.depthMask(false);gl.drawArrays(gl.LINES,0,this.guideCount);gl.depthMask(true);}
    if(this.point&&this.faces.length){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.pointBuffer);gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,0,0);gl.disableVertexAttribArray(this.col);gl.vertexAttrib4f(this.col,1,.3,.5,1);gl.uniform1f(this.pointSize,Math.min(22*dpr,this.maxPointSize));gl.depthMask(false);
      // The ring remains visible through STL; the centre is drawn only where unoccluded.
      gl.disable(gl.DEPTH_TEST);gl.uniform1f(this.markerPass,1);gl.drawArrays(gl.POINTS,0,1);
      gl.enable(gl.DEPTH_TEST);gl.uniform1f(this.markerPass,2);gl.drawArrays(gl.POINTS,0,1);gl.depthMask(true);gl.uniform1f(this.markerPass,0);
    }
    const compass=document.getElementById(this.compassId);if(compass){const m=this.matrix(),aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight),s=.85*this.zoom/(this.radius||1);compass.replaceChildren();for(let i=0;i<3;i++){const x=45+32*m[i*4]*aspect/s,y=45-32*m[i*4+1]/s,line=document.createElementNS('http://www.w3.org/2000/svg','line'),text=document.createElementNS('http://www.w3.org/2000/svg','text');for(const [k,v] of Object.entries({x1:45,y1:45,x2:x,y2:y,stroke:['#f87171','#4ade80','#60a5fa'][i],'stroke-width':2}))line.setAttribute(k,v);text.setAttribute('x',x+3);text.setAttribute('y',y-3);text.setAttribute('fill',['#f87171','#4ade80','#60a5fa'][i]);text.textContent=['X','Y','Z'][i];compass.append(line,text);}}
  }
  view(axis) {this.pan=[0,0];this.zoom=this.fitZoom();const angles={x:[-Math.PI/2,0],y:[0,Math.PI/2],z:[0,0],iso:[-.65,.45]};[this.yaw,this.pitch]=angles[axis];this.draw();}
  pick(x,y,add) {
    const p=[2*x/this.canvas.clientWidth-1,1-2*y/this.canvas.clientHeight],m=this.matrix();let hit=null,depth=Infinity;
    for(const f of this.faces){if(f.hidden)continue;const [a,b,c]=f.v.map(v=>this.project(v,m)),den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-15)continue;const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den,w=1-u-v;if(u>=0&&v>=0&&w>=0){const z=u*a[2]+v*b[2]+w*c[2];if(z>=-1&&z<=1&&z<depth){depth=z;hit=f;}}}
    if(hit)this.onPick(hit,add);
  }
}
