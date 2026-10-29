// Project the actual generated meshes with uniforms from the real draw/resize
// functions. No browser/GPU is needed to find a clipped model.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../static/cloud-models.js'),'utf8');
const functions=source.slice(source.indexOf('  function puffs('),source.indexOf('  function detach('));
const uniforms=Object.fromEntries(['viewport','rotation','shape','anchor','scale','press','layer','tint','haze','opacity'].map(k=>[k,k]));
const current={},draws=[];
const gl={viewport(){},clear(){},enable(){},disable(){},blendFuncSeparate(){},colorMask(){},depthFunc(){},
 uniform1f:(k,v)=>current[k]=v,uniform2f:(k,...v)=>current[k]=v,uniform3fv:(k,v)=>current[k]=[...v],
 uniformMatrix3fv:(k,_,v)=>current[k]=[...v],drawArrays:()=>draws.push(structuredClone(current))};
const context={console,Math,gl,uniforms,canvas:{style:{}},document:{documentElement:{clientWidth:1440},hidden:false},devicePixelRatio:1,
 viewport:{style:{}},
 width:1,height:1,padding:0,viewWidth:1,viewHeight:1,frame:0,visible:true,moving:true,lost:false,time:0,previous:0,pointer:[0,0],target:[0,0],
 requestAnimationFrame:()=>1,scene:{clientHeight:2200,isConnected:true,parentElement:{getBoundingClientRect:()=>({left:56})}},nodes:[],meshes:[]};
vm.createContext(context);vm.runInContext(functions+';globalThis.geometry={puffs,cloudMesh,resize,draw};',context);
const geometry=context.geometry;
const mesh=geometry.cloudMesh(geometry.puffs(1));
context.meshes=Array.from({length:9},()=>({start:0,count:mesh.length/6}));
for(const width of [320,390,768,1440,2200]) {
 const mobile=width<=640,offset=width>1680?(width-1680)/2:12;
 context.document.documentElement.clientWidth=width;
 context.scene.parentElement.getBoundingClientRect=()=>({left:offset});
 for(const aim of [[-1,-1],[1,-1],[1,1],[-1,1],[0,0]]) {
  const stop={offsetLeft:width/2-offset,offsetTop:mobile?115:185,clientWidth:mobile?300:640,
   style:{getPropertyValue:()=>1,setProperty(){}},matches:()=>true,classList:{contains:()=>false}};
  context.nodes=[{stop,mesh:context.meshes[0],shape:[1.18,.95,1],depth:.65,flip:1,lift:1,velocity:0,press:0,aim,tint:[.85,.94,1]}];
  context.pointer=[...aim];context.target=[...aim];context.previous=1000;
  geometry.resize();draws.length=0;geometry.draw(1000);
  const u=draws.at(-1),m=u.rotation;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let i=0;i<mesh.length;i+=6) {
   const local=[mesh[i]*u.shape[0]*(1+u.press*.09),mesh[i+1]*u.shape[1]*(1-u.press*.18),mesh[i+2]*u.shape[2]];
   const p=[0,1,2].map(r=>m[r]*local[0]+m[3+r]*local[1]+m[6+r]*local[2]);
   const scale=u.scale*(1+p[2]*.12),x=u.anchor[0]+p[0]*scale,y=u.anchor[1]-p[1]*scale;
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  assert.ok(minX>=0&&minY>=0&&maxX<=u.viewport[0]&&maxY<=u.viewport[1],`Clipped rotated theory cloud at ${width}/${aim}: ${JSON.stringify({minX,minY,maxX,maxY,viewport:u.viewport})}`);
  assert.ok(context.canvas.width<=4096&&context.canvas.height<=2048,'Bounded decorative drawing buffer');
 }
}
const shapes=Array.from({length:9},(_,seed)=>JSON.stringify(geometry.puffs(seed)));
assert.equal(new Set(shapes).size,9,'Nine distinct deterministic cloud silhouettes');
console.log('PASS cloud models: actual rotated theory mesh fits expanded canvas at 5 widths/5 pointer positions; bounded buffers; 9 distinct silhouettes');
