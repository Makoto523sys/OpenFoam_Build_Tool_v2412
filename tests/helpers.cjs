const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
function app(){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  // Only the test harness gets an introspection hook; the distributed HTML does not.
  const html=fs.readFileSync(require.resolve('../OpenFOAM_v2412_case_builder_v3.html'),'utf8').replace('init();\ninitWorkbench();','window.testAPI={Geometry,geometryParts,getPatches,allFaces,outputs:()=>outputs,blockingErrors,importGeometryFiles,restoreProject,makeZip,bcForField,cfg,importAccelerationFile,importWaterRegionFile,projectSnapshot,accelerationSamples,waterOutputName,Waveform,waveformConfig,waveformResult,viewer:()=>viewer};\ninit();\ninitWorkbench();');
  const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.ResizeObserver=class{observe(){}};w.HTMLCanvasElement.prototype.getContext=()=>null;}});
  if(errors.length)throw errors[0];const w=dom.window,d=w.document;
  const set=(id,value)=>{const el=d.getElementById(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const click=id=>d.getElementById(id).click();
  const file=path=>w.testAPI.outputs().find(o=>o.path.endsWith('/'+path))?.text;
  return {w,d,api:w.testAPI,errors,set,click,file,close:()=>w.close()};
}
module.exports={app};
