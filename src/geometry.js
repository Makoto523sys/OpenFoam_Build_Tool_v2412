/* Geometry is kept in source coordinates. Scaling is applied once, at export. */
const Geometry = (() => {
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const m=Math.hypot(...a); return m?a.map(x=>x/m):[0,0,0];};
  const word=s=>{let v=String(s).replace(/[^A-Za-z0-9_]/g,'_'); return /^[A-Za-z_]/.test(v)?v:'part_'+v;};
  function triangle(vertices,region='surface') {
    if(vertices.length!==3 || vertices.some(v=>v.length!==3||v.some(x=>!Number.isFinite(x)))) throw Error('STLに不正な座標があります。');
    const n=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0]));
    if(!Math.hypot(...n)) throw Error('面積が0の三角形があります。STLを修復してください。');
    return {v:vertices,n:unit(n),region:word(region),patch:word(region),hidden:false};
  }
  function parseSTL(buffer) {
    const view=new DataView(buffer); let faces=[];
    // Binary STL may start with "solid". The count/length is authoritative.
    const count=buffer.byteLength>=84?view.getUint32(80,true):0;
    if(buffer.byteLength>=84 && 84+50*count===buffer.byteLength) {
      if(!count) throw Error('STLに三角形がありません。');
      if(count>500000) throw Error('1ファイル50万三角形までです。STLを軽量化してください。');
      for(let i=0;i<count;i++) {
        const start=84+i*50+12;
        faces.push(triangle(Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>view.getFloat32(start+j*12+k*4,true)))));
      }
    } else {
      const text=new TextDecoder().decode(buffer); let region='surface',vertices=[],inFacet=false;
      for(const raw of text.split(/\r?\n/)) {
        const line=raw.trim();
        if(/^solid(?:\s|$)/i.test(line)) region=line.slice(5).trim()||'surface';
        else if(/^facet\s/i.test(line)) {if(inFacet) throw Error('STL facetが閉じていません。'); inFacet=true; vertices=[];}
        else if(/^vertex\s/i.test(line)) {
          if(!inFacet) throw Error('STL vertexがfacetの外にあります。');
          vertices.push(line.split(/\s+/).slice(1).map(Number));
        } else if(/^endfacet$/i.test(line)) {if(!inFacet) throw Error('不正なSTL facetです。');faces.push(triangle(vertices,region));inFacet=false;}
      }
      if(inFacet||!faces.length) throw Error('有効なASCII / binary STLを読み込めませんでした。');
    }
    if(faces.length>500000) throw Error('1ファイル50万三角形までです。STLを軽量化してください。');
    return faces;
  }
  function bounds(faces) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const f of faces) for(const v of f.v) for(let j=0;j<3;j++){min[j]=Math.min(min[j],v[j]);max[j]=Math.max(max[j],v[j]);}
    return {min,max};
  }
  function topology(faces) {
    const b=bounds(faces),eps=Math.max(...sub(b.max,b.min),1e-20)*1e-8;
    const key=v=>v.map((x,i)=>Math.round((x-b.min[i])/eps)).join(',');
    const edges=new Map(), neighbors=faces.map(()=>[]);
    faces.forEach((f,i)=>{const vs=f.v.map(key);for(let j=0;j<3;j++) {const e=[vs[j],vs[(j+1)%3]].sort().join('|');if(!edges.has(e))edges.set(e,[]);edges.get(e).push(i);}});
    let open=0,nonManifold=0;
    for(const ids of edges.values()) {if(ids.length===1)open++;else if(ids.length!==2)nonManifold++;if(ids.length===2){neighbors[ids[0]].push(ids[1]);neighbors[ids[1]].push(ids[0]);}}
    return {neighbors,open,nonManifold};
  }
  function select(faces,topo,seed,mode,angle) {
    if(!faces[seed]||faces[seed].hidden)return [];
    if(mode==='triangle')return [seed];
    if(mode==='region'||mode==='patch')return faces.flatMap((f,i)=>!f.hidden&&f[mode]===faces[seed][mode]?[i]:[]);
    const seen=new Set([seed]), queue=[seed],limit=Math.cos(angle*Math.PI/180);
    for(let q=0;q<queue.length;q++) for(const n of topo.neighbors[queue[q]]) {
      if(seen.has(n)||faces[n].hidden)continue;
      if(mode==='component'||dot(faces[n].n,faces[seed].n)>=limit) {seen.add(n);queue.push(n);}
    }
    return [...seen];
  }
  function exportSTL(faces,scale=1) {
    if(!Number.isFinite(scale)||scale<=0)throw Error('STL単位係数は正の数にしてください。');
    const groups=new Map();for(const f of faces) {if(!groups.has(f.patch))groups.set(f.patch,[]);groups.get(f.patch).push(f);}
    const out=[];
    for(const [patch,fs] of groups){out.push('solid '+patch);for(const f of fs){out.push('  facet normal '+f.n.join(' '),'    outer loop');for(const v of f.v)out.push('      vertex '+v.map(x=>Number((x*scale).toPrecision(12))).join(' '));out.push('    endloop','  endfacet');}out.push('endsolid '+patch);}
    return out.join('\n')+'\n';
  }
  function measure(faces) {
    let area=0,n=[0,0,0];for(const f of faces){const a=Math.hypot(...cross(sub(f.v[1],f.v[0]),sub(f.v[2],f.v[0])))/2;area+=a;n=n.map((x,i)=>x+a*f.n[i]);}
    return {area,normal:unit(n)};
  }
  function contains(faces,p) {
    const dir=unit([1,0.3713907,0.6947481]);let hits=0;
    for(const f of faces){const e1=sub(f.v[1],f.v[0]),e2=sub(f.v[2],f.v[0]),h=cross(dir,e2),a=dot(e1,h);if(Math.abs(a)<1e-14)continue;const s=sub(p,f.v[0]),u=dot(s,h)/a;if(u<0||u>1)continue;const q=cross(s,e1),v=dot(dir,q)/a;if(v<0||u+v>1)continue;if(dot(e2,q)/a>1e-10)hits++;}
    return hits%2===1;
  }
  function cylinder(origin,axis,radius,length,segments=96) {
    const z=unit(axis),u=unit(cross(z,Math.abs(z[0])<0.8?[1,0,0]:[0,1,0])),v=cross(z,u);
    const c=sign=>origin.map((x,k)=>x+sign*length/2*z[k]);
    const ring=(i,sign)=>c(sign).map((x,k)=>x+radius*(Math.cos(2*Math.PI*i/segments)*u[k]+Math.sin(2*Math.PI*i/segments)*v[k]));
    const fs=[];for(let i=0;i<segments;i++){const a=ring(i,-1),b=ring(i+1,-1),d=ring(i,1),e=ring(i+1,1);fs.push(triangle([a,b,e]),triangle([a,e,d]),triangle([c(-1),b,a]),triangle([c(1),d,e]));}return fs;
  }
  return {sub,dot,cross,unit,word,triangle,parseSTL,bounds,topology,select,exportSTL,measure,contains,cylinder};
})();
if(typeof module!=='undefined')module.exports=Geometry;
