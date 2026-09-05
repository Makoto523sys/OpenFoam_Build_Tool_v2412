/* OpenCFD OpenFOAM-v2412: prescribed translation in a container-fixed frame.
 * CSV acceleration is the container acceleration, not the inertial force.
 * tabulatedAccelerationSource supplies the minus sign and updates g/gh/ghf.
 * See docs/acceleration-evidence.md for source evidence and limitations. */
const Acceleration = (() => {
  const numberToken = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function normalizeUnit(unit) {
    const value=String(unit).trim().toLowerCase().replace(/\s/g,'').replace(/²/g,'2').replace(/\^2/g,'2');
    if(value==='m/s2'||value==='gal'||value==='g') return value;
    throw Error('加速度の単位は m/s²、Gal、g のいずれかを選択してください。');
  }
  function unitFactor(unit='m/s2') {
    return {'m/s2':1,gal:0.01,g:9.80665}[normalizeUnit(unit)];
  }
  function columns(line,lineNumber) {
    const cells=[];let start=0,quoted=false;
    for(let i=0;i<line.length;i++) {
      if(line[i]==='"') {
        if(quoted&&line[i+1]==='"') i++;
        else quoted=!quoted;
      } else if(line[i]===','&&!quoted) {cells.push(line.slice(start,i));start=i+1;}
    }
    if(quoted) throw Error(`CSV ${lineNumber}行目: 引用符が閉じていません。`);
    cells.push(line.slice(start));
    if(cells.length!==4) throw Error(`CSV ${lineNumber}行目: 時刻、X、Y、Z の4列が必要です。`);
    return cells.map(cell=>{
      const value=cell.trim();
      if(value.startsWith('"')) {
        if(!/^"(?:[^"]|"")*"$/.test(value)) throw Error(`CSV ${lineNumber}行目: 引用符が不正です。`);
        return value.slice(1,-1).replace(/""/g,'"').trim();
      }
      if(value.includes('"')) throw Error(`CSV ${lineNumber}行目: 引用符が不正です。`);
      return value;
    });
  }
  function headerCell(value) {
    const match=/^(.*?)(?:\s*(?:\[([^\]]+)\]|\(([^)]+)\)))?$/.exec(value);
    return {name:match[1].trim().toLowerCase().replace(/[\s_]/g,''),unit:match[2]||match[3]||''};
  }
  function checkHeader(cells,unit,lineNumber) {
    const first=headerCell(cells[0]);
    if(!['time','t','時間','時刻'].includes(first.name)) return false;
    if(first.unit&&!['s','sec','second','seconds','秒'].includes(first.unit.trim().toLowerCase())) {
      throw Error(`CSV ${lineNumber}行目: 時刻の単位は秒 (s) です。`);
    }
    ['x','y','z'].forEach((axis,i)=>{
      const cell=headerCell(cells[i+1]);
      const names=[axis,'a'+axis,'acc'+axis,'acceleration'+axis,axis+'acceleration',axis+'方向加速度',axis+'方向の加速度',axis+'加速度'];
      if(!names.includes(cell.name)) throw Error(`CSV ${lineNumber}行目: 見出しは time, ax, ay, az の順にしてください。`);
      if(cell.unit&&normalizeUnit(cell.unit)!==normalizeUnit(unit)) {
        throw Error(`CSV ${lineNumber}行目: 見出しの加速度単位と選択した単位が一致しません。`);
      }
    });
    return true;
  }
  /** Returns raw values in the selected input unit; caller converts to SI once. */
  function parseCSV(text,{unit='m/s2'}={}) {
    normalizeUnit(unit);
    if(typeof text!=='string') throw Error('CSVテキストを読み込んでください。');
    const rows=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/),samples=[];
    let first=true;
    rows.forEach((line,index)=>{
      if(!line.trim()) return;
      const cells=columns(line,index+1);
      if(first) {first=false;if(checkHeader(cells,unit,index+1)) return;}
      const values=cells.map((cell,i)=>{
        if(!numberToken.test(cell)||!Number.isFinite(Number(cell))) {
          throw Error(`CSV ${index+1}行目 ${i+1}列目: 有限な数値を入力してください。`);
        }
        return Number(cell);
      });
      samples.push({time:values[0],acceleration:values.slice(1)});
    });
    const errors=validate(samples);
    if(errors.length) throw Error(errors.join('\n'));
    return samples;
  }
  /** Also use on restored project data. No sorting, clamping or extrapolation. */
  function validate(samples,{startTime,endTime}={}) {
    const errors=[];
    if(!Array.isArray(samples)||samples.length<2) errors.push('加速度CSVには2時刻以上のデータが必要です。');
    let previous;
    if(Array.isArray(samples)) for(const [i,sample] of samples.entries()) {
      if(!sample||!Number.isFinite(sample.time)||sample.time<0) {
        errors.push(`加速度データ ${i+1}点目: 時刻は0以上の有限な数値にしてください。`);
      } else {
        if(previous!==undefined&&sample.time<=previous) errors.push(`加速度データ ${i+1}点目: 時刻は重複させず、厳密な昇順にしてください。`);
        previous=sample.time;
      }
      if(!sample||!Array.isArray(sample.acceleration)||sample.acceleration.length!==3||Array.from(sample.acceleration).some(a=>!Number.isFinite(a))) {
        errors.push(`加速度データ ${i+1}点目: X、Y、Z の有限な加速度3成分が必要です。`);
      }
    }
    if(startTime!==undefined||endTime!==undefined) {
      if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime<0||endTime<=startTime) {
        errors.push('加速度入力では 0 ≤ 開始時刻 < 終了時刻 の解析時間を指定してください。');
      } else if(Array.isArray(samples)&&samples.length>=2&&Number.isFinite(samples[0]?.time)&&Number.isFinite(samples.at(-1)?.time)) {
        if(startTime<samples[0].time||endTime>samples.at(-1).time) {
          errors.push(`解析時間 [${startTime}, ${endTime}] s をCSVの範囲 [${samples[0].time}, ${samples.at(-1).time}] s 内にしてください。範囲外への外挿は行いません。`);
        }
      }
    }
    return errors;
  }
  /** Conservative bound for the last evaluated step, including write alignment. */
  function runMargin({deltaT,adjustTimeStep='no',maxDeltaT,writeControl}={}) {
    if(!Number.isFinite(deltaT)||deltaT<=0) throw Error('加速度CSVの時間刻み deltaT は正の有限値にしてください。');
    if(!['yes','no',true,false].includes(adjustTimeStep)) throw Error('加速度CSVの時間刻み自動調整は yes / no を選択してください。');
    const adaptive=adjustTimeStep===true||adjustTimeStep==='yes';
    if(adaptive&&(!Number.isFinite(maxDeltaT)||maxDeltaT<=0)) {
      throw Error('加速度CSVで時間刻みを自動調整する場合、maxDeltaT に正の有限値を指定してください。CSV終端を越える時間刻みを防ぐために必要です。');
    }
    const margin=Math.max(deltaT,adaptive?maxDeltaT:deltaT)*(writeControl==='adjustableRunTime'?2:1);
    if(!Number.isFinite(margin)) throw Error('加速度CSVの時間刻み上限が数値範囲を超えています。deltaT / maxDeltaT を小さくしてください。');
    return margin;
  }
  function validateRun(samples,options={}) {
    const {startTime,endTime}=options;
    const errors=validate(samples,{startTime:startTime??NaN,endTime:endTime??NaN});
    let margin;
    try{margin=runMargin(options);}catch(e){errors.push(e.message);}
    if(!errors.length) {
      const last=samples.at(-1).time,required=endTime+margin;
      // Decimal endpoint subtraction/addition can differ by a few binary ULPs.
      // This tolerance is tiny relative to the deliberately conservative step.
      const tolerance=Math.min(margin*1e-10,8*Number.EPSILON*Math.max(Math.abs(last),Math.abs(endTime),margin));
      const display=n=>Number(n.toPrecision(12)).toString();
      if(!Number.isFinite(required)||required===endTime) {
        errors.push('解析終了時刻に時間刻みの余裕を加えられません。時刻の原点または時間刻みを見直してください。');
      } else if(last+ tolerance<required) {
        errors.push(`CSV終端に ${display(margin)} s 以上の余裕が必要です。CSVの最終時刻を ${display(required)} s 以上に延ばすか、解析終了時刻を ${display(last-margin)} s 以下にしてください。OpenFOAMが終了時刻をまたぐ最後のステップで範囲外を参照するのを防ぎます。外挿・末尾の自動補完は行いません。`);
      }
    }
    return errors;
  }
  function table(samples) {
    const errors=validate(samples);
    if(errors.length) throw Error(errors.join('\n'));
    return '// Time [s], container acceleration [m/s2], angular velocity [rad/s], angular acceleration [rad/s2]\n'
      +'// Original acceleration sign: OpenFOAM applies gEffective = g - aContainer.\n'
      +'// OpenFOAM-v2412 uses spline interpolation and rejects times outside this table.\n'
      +'(\n'+samples.map(s=>`    (${s.time} ((${s.acceleration.join(' ')}) (0 0 0) (0 0 0)))`).join('\n')+'\n)\n';
  }
  function fvOptions({tablePath='constant/acceleration/translation.dat',name='containerAcceleration'}={}) {
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw Error('加速度ソース名が不正です。');
    if(typeof tablePath!=='string'||!/^constant\/[A-Za-z0-9_./-]+$/.test(tablePath)||tablePath.split('/').some(part=>!part||part==='.'||part==='..')) {
      throw Error('加速度テーブルはconstant内の相対パスを指定してください。');
    }
    return `${name}\n{\n    type tabulatedAccelerationSource;\n    active yes;\n    timeDataFileName "$FOAM_CASE/${tablePath}";\n    U U;\n}\n`;
  }
  return {parseCSV,validate,validateRun,runMargin,table,fvOptions,unitFactor};
})();
if(typeof module!=='undefined')module.exports=Acceleration;
