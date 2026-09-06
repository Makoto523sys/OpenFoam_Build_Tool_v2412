const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
test('runtime validator and generated Allrun pass Python integration tests with explicit OpenFOAM command doubles',()=>{
  const result=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','test_runtime_check.py','-v'],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
