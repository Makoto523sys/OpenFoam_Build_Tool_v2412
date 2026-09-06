import importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('runtime',Path(__file__).resolve().parents[1]/'src/runtime-check.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Audit(unittest.TestCase):
 def mesh(self,d,xy):
  n=len(xy);pts=[(x,y,z) for z in (0,1) for x,y in xy]
  faces=[list(reversed(range(n))),list(range(n,2*n))]+[[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)]
  # Two coplanar triangular faces represent a split planar cell side.
  if n==4:faces=[faces[0],faces[1][:3],[faces[1][0],faces[1][2],faces[1][3]]]+faces[2:]
  values={'points':[f'({x} {y} {z})' for x,y,z in pts],'faces':[str(len(f))+'('+' '.join(map(str,f))+')' for f in faces],'owner':['0']*len(faces),'neighbour':[]}
  files={}
  for k,v in values.items():
   p=Path(d)/k;p.write_text('FoamFile { format ascii; }\n'+str(len(v))+'\n(\n'+'\n'.join(v)+'\n)\n');files[k]=p
  return files
 def test_split_cube(self):
  with tempfile.TemporaryDirectory() as d:
   result=r.convex_mesh_audit(self.mesh(d,[(0,0),(1,0),(1,1),(0,1)]));self.assertTrue(result['passed']);self.assertLess(result['maxOutwardDistance_m'],1e-12)
 def test_concave_prism(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaisesRegex(ValueError,'Nonconvex'):
    r.convex_mesh_audit(self.mesh(d,[(0,0),(2,0),(2,1),(1,1),(1,2),(0,2)]))
 def test_no_waiver_for_fresh_or_other_failed_checks(self):
  log=' ***Concave cells (using face planes) found\nFailed 1 mesh checks.\nEnd\n'
  self.assertTrue(r.checked_quality(None,{'runMode':'fresh','meshMotion':'refine'},None,None,log,0,{},[]))
  self.assertTrue(r.checked_quality(None,{'runMode':'restart','meshMotion':'refine'},None,None,log.replace('Failed 1','Failed 2'),0,{},[]))
  self.assertTrue(r.checked_quality(None,{'runMode':'restart','meshMotion':'refine'},None,None,log,1,{},[]))
if __name__=='__main__':unittest.main()
