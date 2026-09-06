from pathlib import Path
import vtk,numpy as np,json,os,sys
from native_fields import internal
os.environ.setdefault('MPLCONFIGDIR','/tmp/priority-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from vtk.util.numpy_support import vtk_to_numpy
root=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else Path(__file__).resolve().parents[1];name=sys.argv[1] if len(sys.argv)>1 else 'pimple_poiseuille';case=root/name;out=[];fig,ax=plt.subplots()
for t in [.01,.1,.5,1]:
 r=vtk.vtkOpenFOAMReader();r.SetUse64BitFloats(True);r.SetFileName(str(case/(name+'.foam')));r.UpdateInformation();r.EnableAllCellArrays();r.SetTimeValue(t);r.Update();g=r.GetOutput().GetBlock(0);c=vtk.vtkCellCenters();c.SetInputData(g);c.Update();xyz=vtk_to_numpy(c.GetOutput().GetPoints().GetData());y=xyz[:,1];u=internal(case,t,'U',len(y));p=internal(case,t,'p',len(y));H=.1;nu=.01;G=.1
 exact=G*y*(H-y)/(2*nu)
 for n in range(1,400,2):exact-=4*G*H**2/(nu*np.pi**3*n**3)*np.sin(n*np.pi*y/H)*np.exp(-nu*(n*np.pi/H)**2*t)
 out.append({'time':t,'velocityRelativeL2':float(np.linalg.norm(u[:,0]-exact)/np.linalg.norm(exact)),'velocityMaxAbsoluteError':float(abs(u[:,0]-exact).max()),'transverseVelocityMax':float(abs(u[:,1:]).max()),'pressureMaxAbsoluteError':float(abs(p-.1*(1-xyz[:,0])).max())})
 m=abs(xyz[:,0]-.4875)<1e-5;ids=np.flatnonzero(m);ids=ids[np.argsort(y[ids])];ax.plot(u[ids,0],y[ids],'.',label=f'{name} t={t:g}');ax.plot(exact[ids],y[ids],'-',linewidth=.8)
ax.set(xlabel='Velocity [m/s]',ylabel='y [m]');ax.legend();fig.tight_layout();fig.savefig(root/'results'/(name+'_analytic.png'),dpi=160)
print(json.dumps(out,indent=2));(root/'results'/(name+'_analytic.json')).write_text(json.dumps(out,indent=2))
