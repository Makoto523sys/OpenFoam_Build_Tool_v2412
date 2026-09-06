const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function close(actual,expected){expected.forEach((x,i)=>assert.ok(Math.abs(actual[i]-x)<1e-10));}

test('six axis buttons and isometric view are visible and only affect the viewer',()=>{
  const a=app();try{
    a.click('demoGeometry');const original=plain(a.api.outputs()),faces=plain(a.api.allFaces()),v=a.api.viewer();
    for(const [id,name] of [['viewX','x'],['viewNegX','-x'],['viewY','y'],['viewNegY','-y'],['viewZ','z'],['viewNegZ','-z'],['viewIso','iso']]){
      const button=a.d.getElementById(id);assert.equal(button.closest('[hidden]'),null);a.click(id);
      assert.equal(v.viewName,name);assert.equal(button.getAttribute('aria-pressed'),'true');
      assert.equal(a.d.querySelectorAll('[data-view][aria-pressed="true"]').length,1);
    }
    assert.deepEqual(plain(a.api.outputs()),original);assert.deepEqual(plain(a.api.allFaces()),faces);assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('angle inputs apply model-axis increments from the current view and preserve pan, zoom and case data',()=>{
  const a=app();try{
    a.click('demoGeometry');a.click('viewZ');const v=a.api.viewer(),before=plain(a.api.outputs());
    v.pan=[.2,-.1];v.zoom=.8;const center=plain(v.center);
    a.set('viewRotateZ','30');close(v.basis()[0],[1,0,0]);
    a.click('applyViewRotation');a.click('applyViewRotation');close(v.basis()[0],[.5,-Math.sqrt(3)/2,0]);
    assert.equal(a.d.querySelectorAll('[data-view][aria-pressed="true"]').length,0);
    assert.match(a.d.getElementById('viewRotationStatus').textContent,/Z: 30°/);
    assert.equal(v.zoom,.8);assert.deepEqual(plain(v.pan),[.2,-.1]);assert.deepEqual(plain(v.center),center);
    const orientation=plain(v.orientation);a.click('clearViewAngles');close(v.orientation,orientation);
    assert.equal(a.d.getElementById('viewRotateZ').value,'0');assert.deepEqual(plain(a.api.outputs()),before);
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});

test('invalid or incomplete angles do not rotate; corrected input and standard views recover immediately',()=>{
  const a=app();try{
    const v=a.api.viewer();a.click('viewNegX');const before=plain(v.orientation);
    a.set('viewRotateY','');a.set('viewRotateZ','30');a.click('applyViewRotation');
    close(v.orientation,before);assert.equal(a.d.getElementById('viewRotateY').getAttribute('aria-invalid'),'true');
    assert.equal(a.d.getElementById('viewRotationStatus').dataset.error,'true');
    a.set('viewRotateY','0');a.click('applyViewRotation');assert.equal(a.d.getElementById('viewRotationStatus').dataset.error,'false');
    a.click('viewZ');close(v.basis().flat(),[1,0,0,0,1,0,0,0,1]);
    a.set('viewRotateZ','-450');a.click('applyViewRotation');close(v.basis()[0],[0,1,0]);
    assert.equal(a.errors.length,0);
  }finally{a.close();}
});
