const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');

test('force settings have labelled controls and distinct output, shared and coefficient groups',()=>{
  const a=app();
  try{
    const groups=[
      ['foForces','foForceCoeffs'],
      ['foForcePatches','foRhoInf','foCofR'],
      ['foMagUInf','foLRef','foAref','foCoeffDirs'],
    ];
    const fieldsets=groups.map(ids=>{
      const fieldset=a.d.getElementById(ids[0]).closest('fieldset');
      assert.ok(fieldset,'settings belong to a semantic group');
      assert.ok(fieldset.querySelector('legend')?.textContent.trim(),'group has an accessible name');
      for(const id of ids){
        const el=a.d.getElementById(id);
        assert.equal(a.d.querySelectorAll('#'+id).length,1,id+' has a unique ID');
        assert.equal(el.closest('fieldset'),fieldset,id+' is in the appropriate group');
        assert.ok([...el.labels].some(label=>label.textContent.trim()),id+' has an associated label');
        for(const description of (el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean)){
          assert.ok(a.d.getElementById(description)?.textContent.trim(),id+' has a resolvable description');
        }
      }
      return fieldset;
    });
    assert.equal(new Set(fieldsets).size,3,'enablement, common settings and coefficient settings are distinct');
    assert.match(fieldsets[1].querySelector('legend').textContent,/forces.*forceCoeffs/);
    assert.match(fieldsets[2].querySelector('legend').textContent,/forceCoeffs/);
    assert.equal(a.d.getElementById('foCoeffDirs').tagName,'TEXTAREA','long direction values can wrap');
    assert.match(a.d.getElementById('foRhoInf').labels[0].textContent,/kg\/m³/);
    assert.match(a.d.getElementById('foAref').labels[0].textContent,/m²/);
  }finally{a.close();}
});

for(const [forces,coeffs] of [[false,false],[true,false],[false,true],[true,true]]){
  test(`forces=${forces}, forceCoeffs=${coeffs}: independent enablement preserves shared values and coefficient directions`,()=>{
    const a=app();
    try{
      a.set('includeSnappy',false);
      for(const [id,value] of Object.entries({
        foForces:forces,
        foForceCoeffs:coeffs,
        foForcePatches:'tank nozzle',
        foRhoInf:'998.2',
        foCofR:'(1 2 3)',
        foMagUInf:'2.5',
        foLRef:'0.6',
        foAref:'1.4',
        foCoeffDirs:'drag=(0 1 0);\nlift=(0 0 1);\npitch=(1 0 0)',
        foBasicWriteControl:'runTime',
        foBasicWriteInterval:'0.025',
      }))a.set(id,value);
      const control=a.file('system/controlDict');
      assert.ok(control,'controlDict was generated');
      const block=name=>control.match(new RegExp('\\n\\s*'+name+'\\s*\\{([\\s\\S]*?)\\n\\s*\\}'))?.[1];
      for(const [name,enabled,type] of [['forces1',forces,'forces'],['forceCoeffs1',coeffs,'forceCoeffs']]){
        const content=block(name);
        if(!enabled){assert.equal(content,undefined,name+' is omitted');continue;}
        assert.ok(content,name+' is generated');
        assert.match(content,new RegExp('type\\s+'+type+';'));
        assert.match(content,/patches\s+\(tank nozzle\);/);
        assert.match(content,/rho\s+rhoInf;/);
        assert.match(content,/rhoInf\s+998\.2;/);
        assert.match(content,/CofR\s+\(1 2 3\);/);
        assert.match(content,/writeControl\s+runTime;/);
        assert.match(content,/writeInterval\s+0\.025;/);
      }
      if(forces)assert.doesNotMatch(block('forces1'),/magUInf|lRef|Aref|dragDir|liftDir|pitchAxis/);
      if(coeffs){
        const content=block('forceCoeffs1');
        assert.match(content,/magUInf\s+2\.5;/);
        assert.match(content,/lRef\s+0\.6;/);
        assert.match(content,/Aref\s+1\.4;/);
        assert.match(content,/dragDir\s+\(0 1 0\);/);
        assert.match(content,/liftDir\s+\(0 0 1\);/);
        assert.match(content,/pitchAxis\s+\(1 0 0\);/);
      }
      assert.equal(a.errors.length,0);
    }finally{a.close();}
  });
}
