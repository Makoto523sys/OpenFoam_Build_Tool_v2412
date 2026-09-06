from pathlib import Path
import vtk,numpy as np,json,sys
from native_fields import internal
from vtk.util.numpy_support import vtk_to_numpy
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
def read(name,t):
 r=vtk.vtkOpenFOAMReader();r.SetUse64BitFloats(True);r.SetFileName(str(root/name/(name+'.foam')));r.UpdateInformation();r.EnableAllCellArrays();r.SetTimeValue(t);r.Update();g=r.GetOutput().GetBlock(0);c=vtk.vtkCellCenters();c.SetInputData(g);c.Update();xyz=vtk_to_numpy(c.GetOutput().GetPoints().GetData());order=np.lexsort(np.round(xyz,8).T[::-1]);return g,xyz[order],order
out={}
for base,name,t in [('pimple_poiseuille','pimple_parallel',1),('pimple_poiseuille','pimple_restart',1),('amr_serial','amr_parallel',.2),('amr_serial','amr_restart',.2),('csv_serial','csv_parallel',21),('csv_serial','csv_restart',21),('amr_serial_tight','amr_parallel_tight',.2),('csv_serial_tight','csv_parallel_tight',21),('pimple_poiseuille','pimple_parallel_restart',1),('amr_serial','amr_parallel_restart',.2),('csv_serial','csv_parallel_restart',21)]:
 if not (root/name/f'{t:g}'/'U').exists():continue
 g,x,i=read(base,t);h,y,j=read(name,t);d={'time':t,'referenceCells':len(x),'comparedCells':len(y)}
 if x.shape==y.shape and np.max(abs(x-y))<1e-7:
  d['maxCellCentreDifference_m']=float(np.max(abs(x-y)))
  for field in ['U','p','p_rgh','alpha.water']:
   if g.GetCellData().GetArray(field) is None:continue
   a=internal(root/base,t,field,len(x))[i];b=internal(root/name,t,field,len(y))[j]
   d[field]={'Linf':float(abs(a-b).max()),'relativeL2':float(np.linalg.norm(a-b)/max(np.linalg.norm(a),1e-30))}
 else:d['meshMismatch']=True
 if not base.startswith('pimple'):
  a=np.loadtxt(root/base/'postProcessing/cornerHeights/0/height.dat');pieces=[]
  for p in (root/name/'postProcessing/cornerHeights').glob('*/height.dat'):pieces.extend(np.loadtxt(p,ndmin=2))
  b=np.array(sorted(pieces,key=lambda r:r[0]));mask=b[:,0]>=(float(b[0,0]));ref=np.column_stack([np.interp(b[:,0],a[:,0],a[:,k]) for k in range(1,a.shape[1],2)]);d['maxGaugeDifference_m']=float(abs(b[:,1::2]-ref).max())
 out[name]=d
print(json.dumps(out,indent=2));(root/'results/parallel_restart_comparison.json').write_text(json.dumps(out,indent=2))
