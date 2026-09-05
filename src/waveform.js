/* Analytic acceleration -> sampled history. No JavaScript evaluation. */
const Waveform=(()=>{
  const MAX_POINTS=200001;
  const functions={sin:[1,Math.sin],cos:[1,Math.cos],tan:[1,Math.tan],exp:[1,Math.exp],log:[1,Math.log],sqrt:[1,Math.sqrt],abs:[1,Math.abs],min:[2,Math.min],max:[2,Math.max]};
  const variables=new Set(['t','tau','A','f','T','phi','b']);
  const acceleration=()=>typeof Acceleration!=='undefined'?Acceleration:require('./acceleration.js');
  function compile(expression){
    if(typeof expression!=='string'||!expression.trim()||expression.length>512)throw Error('数式は1〜512文字で入力してください。');
    const tokens=[];let pos=0;
    while(pos<expression.length){
      const rest=expression.slice(pos),space=/^\s+/.exec(rest);if(space){pos+=space[0].length;continue;}
      const match=/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9]*|^[+\-*/^(),]/.exec(rest);
      if(!match)throw Error(`数式の ${pos+1}文字目を解釈できません。演算子は + - * / ^ を使ってください。`);
      tokens.push(match[0]);pos+=match[0].length;if(tokens.length>256)throw Error('数式が長すぎます。256トークン以下に分けてください。');
    }
    let index=0,depth=0;
    const peek=()=>tokens[index],take=()=>tokens[index++];
    const expect=value=>{if(take()!==value)throw Error(`数式には ${value} が必要です。`);};
    function primary(){
      if(++depth>32)throw Error('数式の括弧・累乗の入れ子が深すぎます。');
      try{
        const token=take();if(token===undefined)throw Error('数式が途中で終わっています。');
        if(token==='('){const value=sum();expect(')');return value;}
        if(/^(?:\d|\.)/.test(token)){const number=Number(token);if(!Number.isFinite(number))throw Error('数式の定数は有限値にしてください。');return {kind:'number',value:number};}
        if(Object.hasOwn(functions,token)){
          expect('(');const args=[sum()];while(peek()===','){take();args.push(sum());}expect(')');
          if(args.length!==functions[token][0])throw Error(`${token} の引数は${functions[token][0]}個です。`);
          return {kind:'call',name:token,args};
        }
        if(token==='pi'||token==='e')return {kind:'number',value:token==='pi'?Math.PI:Math.E};
        if(variables.has(token))return {kind:'variable',name:token};
        throw Error(`数式の ${token} は使用できません。変数・関数名を確認してください。`);
      }finally{depth--;}
    }
    function power(){const left=primary();if(peek()==='^'){take();return {kind:'binary',op:'^',left,right:unary()};}return left;}
    function unary(){if(peek()==='+'||peek()==='-'){const op=take();return {kind:'unary',op,value:unary()};}return power();}
    function product(){let node=unary();while(peek()==='*'||peek()==='/'){const op=take();node={kind:'binary',op,left:node,right:unary()};}return node;}
    function sum(){let node=product();while(peek()==='+'||peek()==='-'){const op=take();node={kind:'binary',op,left:node,right:product()};}return node;}
    const tree=sum();if(index!==tokens.length)throw Error(`数式の ${peek()} の前に演算子が必要です。掛け算には * を入れてください。`);
    function evaluate(node,values){
      let result;
      if(node.kind==='number')result=node.value;
      else if(node.kind==='variable')result=values[node.name];
      else if(node.kind==='unary'){const n=evaluate(node.value,values);result=node.op==='-'?-n:n;}
      else if(node.kind==='call')result=functions[node.name][1](...node.args.map(arg=>evaluate(arg,values)));
      else {const a=evaluate(node.left,values),b=evaluate(node.right,values);result=node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:node.op==='/'?a/b:a**b;}
      if(!Number.isFinite(result))throw Error('数式の演算結果が有限値ではありません。定義域・ゼロ除算・オーバーフローを確認してください。');
      return result;
    }
    return values=>evaluate(tree,values);
  }
  function axisDefinition(axis,label){
    if(!axis||!['zero','sine','cosine','constant','expression'].includes(axis.kind))throw Error(`${label}: 波形の種類を選択してください。`);
    if(axis.kind==='zero')return {evaluate:()=>0,formula:'0'};
    if(!Number.isFinite(axis.offset))throw Error(`${label}: オフセット b は有限値にしてください。`);
    if(axis.kind==='constant')return {evaluate:()=>axis.offset,formula:String(axis.offset)};
    for(const key of ['amplitude','phase','cycle'])if(!Number.isFinite(axis[key]))throw Error(`${label}: 振幅・位相・周期/周波数は有限値にしてください。`);
    if(!['period','frequency'].includes(axis.cycleMode)||axis.cycle<=0)throw Error(`${label}: 周期 [s] または周波数 [Hz] は正の値にしてください。`);
    const period=axis.cycleMode==='period'?axis.cycle:1/axis.cycle,frequency=1/period;
    if(!Number.isFinite(period)||!Number.isFinite(frequency)||period<=0||frequency<=0)throw Error(`${label}: 周期/周波数を数値で表せる範囲にしてください。`);
    const phi=(axis.phase%360)*Math.PI/180,constants={A:axis.amplitude,b:axis.offset,f:frequency,T:period,phi};
    if(axis.kind==='expression'){
      const run=compile(axis.expression);return {evaluate:(t,tau)=>run({...constants,t,tau}),formula:axis.expression};
    }
    const fn=axis.kind==='sine'?Math.sin:Math.cos,name=axis.kind==='sine'?'sin':'cos';
    return {period,evaluate:(t,tau)=>axis.offset+axis.amplitude*fn(2*Math.PI*((tau%period)/period)+phi),formula:`${axis.offset} + ${axis.amplitude}*${name}(2*pi*${frequency}*tau + ${phi})`};
  }
  function generate(config){
    if(!config||typeof config!=='object')throw Error('波形の設定を入力してください。');
    const {startTime,endTime,sampleInterval,axes,unit}=config;
    if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime<0||endTime<=startTime)throw Error('波形の生成時間は 0 ≤ 開始時刻 < 終了時刻 にしてください。');
    if(!Number.isFinite(sampleInterval)||sampleInterval<=0)throw Error('波形の標本間隔は正の有限値にしてください。');
    const span=endTime-startTime;if(!Number.isFinite(span))throw Error('波形の生成時間が大きすぎます。');
    const ratio=span/sampleInterval;
    if(!Number.isFinite(ratio)||Math.ceil(ratio)+1>MAX_POINTS)throw Error(`波形は${MAX_POINTS.toLocaleString()}点までです。標本間隔を大きくするか生成時間を短くしてください。`);
    const factor=acceleration().unitFactor(unit),names=['x','y','z'],definitions=names.map(name=>{try{return axisDefinition(axes?.[name],name.toUpperCase());}catch(e){throw Error(e.message.startsWith(name.toUpperCase()+':')?e.message:name.toUpperCase()+': '+e.message);}}),warnings=[];
    definitions.forEach((definition,i)=>{
      if(!definition.period)return;
      if(sampleInterval>definition.period/20*(1+1e-12))throw Error(`${names[i].toUpperCase()}: 正弦波・余弦波は1周期あたり20点以上で標本化してください。標本間隔を ${definition.period/20} s 以下にしてください。`);
      if(sampleInterval>definition.period/100*(1+1e-12))warnings.push(`${names[i].toUpperCase()}: 1周期あたり100点以上を目安に標本間隔を細かくし、波形の再現性を確認してください。`);
    });
    if(names.some(name=>axes[name].kind==='expression'))warnings.push('数式の最大周波数・不連続点は自動判定できません。標本間隔と解析時間刻みを細かくして確認してください。');
    const times=[startTime],tolerance=8*Number.EPSILON*Math.max(Math.abs(startTime),Math.abs(endTime),sampleInterval);
    for(let i=1;i<=Math.ceil(ratio);i++){
      const time=startTime+i*sampleInterval;
      if(time>=endTime||endTime-time<=Math.min(sampleInterval*1e-8,tolerance))break;
      if(time<=times.at(-1))throw Error('この時刻の大きさでは標本間隔を区別できません。時刻の原点または標本間隔を見直してください。');
      times.push(time);
    }
    if(endTime<=times.at(-1))throw Error('生成終了時刻を区別できません。');times.push(endTime);
    const rawSamples=times.map(time=>({time,acceleration:definitions.map((definition,i)=>{
      let value;try{value=definition.evaluate(time,time-startTime);}catch(e){throw Error(`${names[i].toUpperCase()}: t=${time} s: ${e.message}`);}
      if(!Number.isFinite(value)||!Number.isFinite(value*factor))throw Error(`${names[i].toUpperCase()}: t=${time} s の加速度が有限値ではありません。数式の定義域・除算・単位・振幅を確認してください。`);
      return value;
    })}));
    const samples=rawSamples.map(s=>({time:s.time,acceleration:s.acceleration.map(x=>x*factor)}));
    const errors=acceleration().validate(samples);if(errors.length)throw Error(errors.join('\n'));
    return {samples,rawSamples,warnings,formulas:Object.fromEntries(names.map((name,i)=>[name,definitions[i].formula]))};
  }
  function csv(result,unit='m/s2'){
    acceleration().unitFactor(unit);
    const errors=acceleration().validate(result?.rawSamples);if(errors.length)throw Error(errors.join('\n'));
    return `time[s],ax[${unit}],ay[${unit}],az[${unit}]\n`+result.rawSamples.map(s=>[s.time,...s.acceleration].join(',')).join('\n')+'\n';
  }
  return {compile,generate,csv,MAX_POINTS};
})();
if(typeof module!=='undefined')module.exports=Waveform;
