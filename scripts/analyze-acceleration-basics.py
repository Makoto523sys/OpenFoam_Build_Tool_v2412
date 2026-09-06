from pathlib import Path
import sys,json,os
import numpy as np
from native_fields import internal
os.environ.setdefault('MPLCONFIGDIR','/tmp/priority-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
def heights(name):return np.loadtxt(root/name/'postProcessing/cornerHeights/0/height.dat')
s=heights('gravity_static');c=heights('gravity_tilt');i=heights('gravity_tilt_interior');x=np.array([.15,.35,.85,1.05]);theory=1.2-.1*(x-.6)
last=s[s[:,0]>=45,1::2];inter=i[:,1::2];mean=inter.mean(axis=0)
out={'gravity_m_s2':[0,0,-9.81],'constantContainerAcceleration_m_s2':[.981,0,0],'static':{'endTime_s':float(s[-1,0]),'last5sMeanHeight_m':last.mean(axis=0).tolist(),'last5sMaxHeightError_m':float(abs(last-1.2).max()),'last5sPeakToPeak_m':np.ptp(last,axis=0).tolist(),'finalMaxSpeed_m_s':float(np.linalg.norm(internal(root/'gravity_static',50,'U',2880),axis=1).max())},'tilt':{'theorySlope':-.1,'interiorPointsX_m':x.tolist(),'theoryHeight_m':theory.tolist(),'meanHeight45to50_s_m':mean.tolist(),'fittedSlope':float(np.polyfit(x,mean,1)[0]),'maxHeightError_m':float(abs(inter-theory).max()),'cornerMaxError_m':float(abs(c[c[:,0]>=45,1::2]-np.array([1.2595,1.1405,1.2595,1.1405])).max()),'note':'Corner values are affected by the coarse 0.1 m mesh and boundary extrapolation.'}}
(root/'results/gravity_basics.json').write_text(json.dumps(out,indent=2))
fig,axes=plt.subplots(1,2,figsize=(10,4));axes[0].plot(s[:,0],(s[:,1::2]-1.2)*1000);axes[0].set(xlabel='Time [s]',ylabel='Still-water height error [mm]');axes[1].plot(x,theory,'-',label='Hydrostatic theory');axes[1].plot(x,mean,'o',label='interFoam, mean 45-50 s');axes[1].set(xlabel='x [m]',ylabel='Water height [m]');axes[1].legend();fig.tight_layout();fig.savefig(root/'results/gravity_basics.png',dpi=160)
print(json.dumps(out,indent=2))
