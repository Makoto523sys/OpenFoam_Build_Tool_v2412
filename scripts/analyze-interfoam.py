"""Read native solver output only; never modify case dictionaries."""
from pathlib import Path
import re,json,csv,sys,os
os.environ.setdefault('MPLCONFIGDIR','/tmp/interfoam-matplotlib')
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import vtk
from vtk.util.numpy_support import vtk_to_numpy,numpy_to_vtk
# Usage: python3 scripts/analyze-interfoam.py amr|sloshing /path/to/generated-cases
root=Path(sys.argv[2] if len(sys.argv)>2 else 'interfoam-output').resolve()
out=root/'results';out.mkdir(exist_ok=True)

def table(p):return np.loadtxt(p,comments='#',ndmin=2)
def savecsv(p,head,data):np.savetxt(p,data,delimiter=',',header=head,comments='',fmt='%.12g')
def grid(case,time):
 r=vtk.vtkOpenFOAMReader();r.SetFileName(str(root/case/(case+'.foam')));r.UpdateInformation();r.EnableAllCellArrays();r.SetTimeValue(time);r.Update();return r.GetOutput().GetBlock(0)
def stats(case):
 text=(root/case/'log.interFoam').read_text();ts=re.findall(r'^Time = ([\d.e+-]+)$',text,re.M)
 fractions=np.array(re.findall(r'Phase-1 volume fraction = (\S+)  Min\(alpha.water\) = (\S+)  Max\(alpha.water\) = (\S+)',text),float)
 v=table(root/case/'postProcessing/volFieldValue1/0/volFieldValue.dat')
 h=table(root/case/'postProcessing/cornerHeights/0/height.dat')
 assert np.isfinite(h).all() and np.max(abs(h))<1e10,case+' invalid gauge'
 g0=grid(case,0);sizes=vtk.vtkCellSizeFilter();sizes.SetInputData(g0);sizes.Update();vol=vtk_to_numpy(sizes.GetOutput().GetCellData().GetArray('Volume'));a=vtk_to_numpy(g0.GetCellData().GetArray('alpha.water'))
 assert np.ptp(vol)/np.mean(vol)<1e-4, 'Example initial mesh must have uniform cell volume'
 initial=float(re.search(r'Total volume = (\S+)',(root/case/'log.checkMesh').read_text())[1].rstrip('.'))*float(np.mean(a,dtype=np.float64));result={'lastTime':float(ts[-1]),'ended':text.rstrip().endswith('End'),'initialCells':len(a),'initialWaterCells':int(np.sum(a==1)),'initialWaterVolume_m3':initial,'finalWaterVolume_m3':float(v[-1,1]),'waterChange_percent':float((v[-1,1]/initial-1)*100),'alphaMin':float(fractions[:,1].min()),'alphaMax':float(fractions[:,2].max()),'heightRows':len(h),'heightMin_m':h[:,1::2].min(axis=0).tolist(),'heightMax_m':h[:,1::2].max(axis=0).tolist(),'warnings':text.count('FOAM Warning'),'fatal':text.count('FOAM FATAL')}
 savecsv(out/(case+'_heights.csv'),'time_s,'+','.join('height_'+str(i)+'_m' for i in range(h[:,1::2].shape[1])),np.column_stack([h[:,0],h[:,1::2]]))
 savecsv(out/(case+'_water_volume.csv'),'time_s,water_volume_m3',v)
 return result

def amr():
 cases=['damBreak_coarse','damBreak_stl','damBreak_amr','damBreak_amr_level2'];summary={}
 fig,ax=plt.subplots(1,2,figsize=(12,4))
 for case in cases:
  summary[case]=stats(case);s=(root/case/'log.interFoam').read_text();counts=[[0,summary[case]['initialCells']]];t=0
  for line in s.splitlines():
   m=re.match(r'Time = ([\d.e+-]+)$',line)
   if m:t=float(m[1])
   m=re.match(r'(?:Unrefined|Refined) from (\d+) to (\d+) cells\.',line)
   if m:counts.append([t,int(m[2])])
  if len(counts)==1:counts.append([1,counts[0][1]])
  counts=np.array(counts);summary[case]['maxCellsDuringAdaptation']=int(counts[:,1].max());summary[case]['finalCells']=int(counts[-1,1]);summary[case]['refinementEvents']=len(re.findall(r'^Refined from',s,re.M));summary[case]['unrefinementEvents']=len(re.findall(r'^Unrefined from',s,re.M))
  savecsv(out/(case+'_cell_count.csv'),'time_s,cells',counts);ax[0].step(counts[:,0],counts[:,1],where='post',label=case.replace('damBreak_',''))
  v=table(root/case/'postProcessing/volFieldValue1/0/volFieldValue.dat');ax[1].plot(v[:,0],100*(v[:,1]/summary[case]['initialWaterVolume_m3']-1),label=case.replace('damBreak_',''))
 ax[0].set(xlabel='Time [s]',ylabel='Cells');ax[1].set(xlabel='Time [s]',ylabel='Water volume change [%]');ax[0].legend();ax[1].legend();fig.tight_layout();fig.savefig(out/'damBreak_amr_history.png',dpi=160);plt.close(fig)
 fig,axs=plt.subplots(3,2,figsize=(10,13));snapshots=[]
 for row,t in enumerate([.1,.5,1]):
  g=grid('damBreak_amr_level2',t);a=vtk_to_numpy(g.GetCellData().GetArray('alpha.water'));lev=vtk_to_numpy(g.GetCellData().GetArray('cellLevel'));mixed=(a>.001)&(a<.999)
  snapshots.append({'time':t,'cells':len(a),'levels':{str(int(x)):int(np.sum(lev==x)) for x in np.unique(lev)},'mixedCells':int(mixed.sum()),'mixedCellsAtMaxLevel_percent':float(100*np.mean(lev[mixed]==2))})
  plane=vtk.vtkPlane();plane.SetOrigin(0,.0061,0);plane.SetNormal(0,1,0);c=vtk.vtkCutter();c.GenerateTrianglesOff();c.SetInputData(g);c.SetCutFunction(plane);c.Update();p=c.GetOutput();pts=vtk_to_numpy(p.GetPoints().GetData());polys=[]
  for i in range(p.GetNumberOfCells()):
   ids=p.GetCell(i).GetPointIds();polys.append(pts[[ids.GetId(j) for j in range(ids.GetNumberOfIds())]][:,[0,2]])
  for col,(field,limit,cmap) in enumerate([('alpha.water',1,'Blues'),('cellLevel',2,'viridis')]):
   coll=PolyCollection(polys,array=vtk_to_numpy(p.GetCellData().GetArray(field)),cmap=cmap,edgecolors='0.25',linewidths=.12);coll.set_clim(0,limit);axs[row,col].add_collection(coll);axs[row,col].set(xlim=(0,.584),ylim=(0,.584),xlabel='x [m]',ylabel='z [m]',title=f'{field}, t={t:g} s',aspect='equal');fig.colorbar(coll,ax=axs[row,col],shrink=.7)
 fig.tight_layout();fig.savefig(out/'damBreak_amr_interface.png',dpi=170);plt.close(fig)
 summary['level2Snapshots']=snapshots;(out/'damBreak_summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))

def slosh():
 summary=stats('sloshing_csv');assert summary['ended'] and summary['lastTime']==50
 h=table(root/'sloshing_csv/postProcessing/cornerHeights/0/height.dat');fig,axs=plt.subplots(2,1,figsize=(12,7),sharex=True)
 for i,name in enumerate(['x0,y0','xL,y0','x0,yW','xL,yW']):axs[0].plot(h[:,0],h[:,1+2*i],label=name,linewidth=.9)
 axs[0].axvline(20,color='0.4',linestyle='--');axs[0].set(ylabel='Equivalent water depth [m]');axs[0].legend(ncol=4)
 acc=table_csv(root/'sloshing_csv/constant/acceleration/container.csv')
 for i in range(3):axs[1].plot(acc[:,0],acc[:,i+1],label='a'+'xyz'[i])
 axs[1].set(xlabel='Time [s]',ylabel='Container acceleration [m/s2]',xlim=(0,50));axs[1].legend(ncol=3);fig.tight_layout();fig.savefig(out/'sloshing_heights_acceleration.png',dpi=170);plt.close(fig)
 wallout=out/'wallShearStress_Pa';wallout.mkdir(exist_ok=True);rows=[];peak=(-1,None)
 for p in sorted((root/'sloshing_csv/postProcessing/wallSamples').glob('*/*.vtp'),key=lambda p:(float(p.parent.name),p.name)):
  reader=vtk.vtkXMLPolyDataReader();reader.SetFileName(str(p));reader.Update();data=reader.GetOutput();cd=data.GetCellData();rho=vtk_to_numpy(cd.GetArray('rho'));tau=vtk_to_numpy(cd.GetArray('wallShearStress'))*rho[:,None];mag=np.linalg.norm(tau,axis=1)
  assert np.isfinite(tau).all();t=float(p.parent.name);imax=int(mag.argmax());rows.append([t,p.stem,len(tau),float(mag.max()),float(np.sqrt(np.mean(mag**2)))])
  if mag[imax]>peak[0]:peak=(float(mag[imax]),(t,p.stem))
  for name,a in [('wallShearStress_Pa',tau),('wallShearStressMagnitude_Pa',mag)]:v=numpy_to_vtk(a,deep=True);v.SetName(name);cd.AddArray(v)
  dest=wallout/p.parent.name;dest.mkdir(exist_ok=True);writer=vtk.vtkXMLPolyDataWriter();writer.SetDataModeToAscii();writer.SetFileName(str(dest/p.name));writer.SetInputData(data);writer.Write()
 with (out/'wallShearStress_summary.csv').open('w') as f:
  w=csv.writer(f);w.writerow(['time_s','wall','faces','maximum_Pa','rms_Pa']);w.writerows(rows)
 summary['wallSurfaceFiles']=len(rows);summary['peakWallShearStress_Pa']=peak[0];summary['peakWallShearStressTimeAndWall']=peak[1]
 fig,axs=plt.subplots(1,2,figsize=(7,8),sharey=True);time=peak[1][0]
 for ax,name in zip(axs,['shortWall_x0','shortWall_xL']):
  p=wallout/f'{time:g}'/(name+'.vtp');reader=vtk.vtkXMLPolyDataReader();reader.SetFileName(str(p));reader.Update();data=reader.GetOutput();points=vtk_to_numpy(data.GetPoints().GetData());polys=[]
  for i in range(data.GetNumberOfCells()):ids=data.GetCell(i).GetPointIds();polys.append(points[[ids.GetId(j) for j in range(ids.GetNumberOfIds())]][:,[1,2]])
  coll=PolyCollection(polys,array=vtk_to_numpy(data.GetCellData().GetArray('wallShearStressMagnitude_Pa')),cmap='magma');coll.set_clim(0,peak[0]);ax.add_collection(coll);ax.set(xlim=(0,.8),ylim=(0,3),aspect='equal',xlabel='y [m]',ylabel='z [m]',title=f'{name}, t={time:g}s');fig.colorbar(coll,ax=ax,shrink=.7,label='Shear stress magnitude [Pa]')
 fig.tight_layout();fig.savefig(out/'sloshing_wall_shear.png',dpi=170);plt.close(fig)
 (out/'sloshing_summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
def table_csv(p):return np.loadtxt(p,delimiter=',',skiprows=1)
if __name__=='__main__':
 {'amr':amr,'sloshing':slosh}[sys.argv[1]]()
