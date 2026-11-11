// Doodle Turf v2 - free-form territory. Land is real polygons (no grid); capturing = polygon union/difference.
const express=require('express'),http=require('http'),{Server}=require('socket.io'),pc=require('polygon-clipping');
const app=express(),srv=http.createServer(app),io=new Server(srv);
app.use(express.static(__dirname+'/public'));
const W=80,SPD=6,TURN=3.4,DT=.05,GAP=.5,MAXT=700,BOTS=+(process.env.BOTS??4);
const P=new Map(),dirty=new Set();let tk=0,lb=[];
const r2=v=>Math.round(v*100)/100,wire=m=>m.map(pg=>pg.map(r=>r.map(p=>[r2(p[0]),r2(p[1])]))),flat=t=>t.flatMap(p=>[r2(p[0]),r2(p[1])]);
const free=()=>{for(let i=1;i<251;i++)if(!P.has(i))return i};
// ---- geometry helpers ----
function inRing(r,x,y){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>y)!=(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
const inMP=(m,x,y)=>m.some(pg=>inRing(pg[0],x,y)&&!pg.slice(1).some(h=>inRing(h,x,y)));
function segInt(ax,ay,bx,by,cx,cy,dx,dy){const d=(bx-ax)*(dy-cy)-(by-ay)*(dx-cx);if(!d)return false;
  const t=((cx-ax)*(dy-cy)-(cy-ay)*(dx-cx))/d,u=((cx-ax)*(by-ay)-(cy-ay)*(bx-ax))/d;return t>=0&&t<=1&&u>=0&&u<=1}
const ra=r=>{let s=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];s+=a[0]*b[1]-b[0]*a[1]}return Math.abs(s)/2};
const area=m=>m.reduce((s,pg)=>s+ra(pg[0])-pg.slice(1).reduce((t,h)=>t+ra(h),0),0);
// ---- game rules ----
function spawn(p){
  let x,y;
  for(let t=0;t<40;t++){x=7+Math.random()*(W-14);y=7+Math.random()*(W-14);
    if(![...P.values()].some(q=>q!==p&&q.alive&&(inMP(q.terr,x,y)||Math.hypot(q.x-x,q.y-y)<12)))break}
  const ring=Array.from({length:20},(_,i)=>[x+3*Math.cos(i/20*6.283),y+3*Math.sin(i/20*6.283)]);
  Object.assign(p,{x,y,hx:x,hy:y,a:Math.random()*6.28,w:0,alive:1,out:false,trail:[],sent:0,terr:[[ring]]});p.ta=p.a;dirty.add(p.id);
}
function kill(p,by){
  if(!p.alive)return;p.alive=0;p.trail=[];p.terr=[];p.sent=0;io.emit('tc',p.id);dirty.add(p.id);if(by)by.kills++;
  if(p.sock)p.sock.emit('dead',{by:by?by.name:null});else setTimeout(()=>P.has(p.id)&&spawn(p),2500);
}
function clean(t){const r=[];for(const p of t){const q=[Math.round(p[0]*1000)/1000,Math.round(p[1]*1000)/1000],l=r[r.length-1];if(!l||l[0]!=q[0]||l[1]!=q[1])r.push(q)}return r}
function capture(p){ // the trail loop becomes land; whatever was inside (enemy land included) is taken
  const ring=clean(p.trail);p.trail=[];p.sent=0;io.emit('tc',p.id);if(ring.length<3)return;
  try{
    const poly=[ring];p.terr=pc.union(p.terr,poly);dirty.add(p.id);
    for(const q of P.values())if(q!==p&&q.alive){q.terr=pc.difference(q.terr,poly);dirty.add(q.id);if(!q.terr.length)kill(q,p)}
  }catch(e){console.error('capture failed:',e.message)}
}
function step(p){
  // turning has inertia: angular velocity eases toward the wanted turn rate
  const d=Math.atan2(Math.sin(p.ta-p.a),Math.cos(p.ta-p.a));
  p.w+=(Math.max(-TURN,Math.min(TURN,d*6))-p.w)*.25;p.a+=p.w*DT;
  const ox=p.x,oy=p.y; // walls: slide along the edge
  p.x=Math.min(W,Math.max(0,p.x+Math.cos(p.a)*SPD*DT));p.y=Math.min(W,Math.max(0,p.y+Math.sin(p.a)*SPD*DT));
  const was=p.out;p.out=!inMP(p.terr,p.x,p.y);
  // touching any trail (their head-to-tail path included) cuts it; touching your own tail kills you
  for(const q of P.values()){
    if(!q.alive||!q.trail.length||(q===p&&!p.out))continue;
    const T=q===p?q.trail:q.trail.concat([[q.x,q.y]]),lim=T.length-1-(q===p?4:0);
    for(let i=0;i<lim;i++)if(segInt(ox,oy,p.x,p.y,T[i][0],T[i][1],T[i+1][0],T[i+1][1])){if(q===p){kill(p);return}kill(q,p);break}
  }
  if(p.out){
    if(!was)p.trail=[[ox,oy]];
    const l=p.trail[p.trail.length-1];if(Math.hypot(p.x-l[0],p.y-l[1])>GAP&&p.trail.length<MAXT)p.trail.push([p.x,p.y]);
  }else if(was){p.trail.push([p.x,p.y]);capture(p)}
}
function ai(p){
  p.ta+=(Math.random()-.5)*2;
  if(p.trail.length>16)p.ta=Math.atan2(p.hy-p.y,p.hx-p.x);
  if(p.x<5||p.x>W-5||p.y<5||p.y>W-5)p.ta=Math.atan2(W/2-p.y,W/2-p.x);
}
for(let i=0;i<BOTS;i++){const id=free(),p={id,name:['Bubbles','Waffle','Noodle','Pickle','Mochi'][i%5],hue:(i*77+20)%360,bot:1,kills:0};P.set(id,p);spawn(p)}
const full=()=>({t:[...P.values()].filter(p=>p.alive).map(p=>[p.id,p.hue,wire(p.terr)]),tr:[...P.values()].filter(p=>p.alive&&p.trail.length).map(p=>[p.id,flat(p.trail)])});

io.on('connection',s=>{let p;
  s.emit('init',{W});s.emit('full',full());
  s.on('join',n=>{
    if(p&&p.alive)return;
    if(!p){const id=free();if(!id)return;p={id,name:String(n||'Player').slice(0,12),hue:(Math.random()*360)|0,sock:s,kills:0};P.set(id,p)}
    spawn(p);s.emit('me',p.id);
  });
  s.on('in',a=>{if(p&&typeof a=='number'&&isFinite(a))p.ta=a});
  s.on('disconnect',()=>{if(p){kill(p);P.delete(p.id)}});
});

setInterval(()=>{
  tk++;
  for(const p of P.values())if(p.alive){if(p.bot&&tk%8==0)ai(p);step(p)}
  if(tk%10==0){
    for(const p of P.values())p.score=p.alive?Math.round(area(p.terr)*1000/(W*W))/10:0;
    lb=[...P.values()].filter(p=>p.alive).sort((a,b)=>b.score-a.score).slice(0,5).map(p=>[p.name,p.score,p.hue]);
  }
  if(dirty.size){io.emit('t',[...dirty].map(id=>{const p=P.get(id);return[id,p?p.hue:0,p&&p.alive?wire(p.terr):[]]}));dirty.clear()}
  const tr=[];for(const p of P.values())if(p.alive&&p.trail.length>p.sent){tr.push([p.id,flat(p.trail.slice(p.sent))]);p.sent=p.trail.length}
  if(tr.length)io.emit('tr',tr);
  io.volatile.emit('st',{lb,p:[...P.values()].filter(p=>p.alive).map(p=>[p.id,p.name,p.hue,r2(p.x),r2(p.y),r2(p.a),p.score||0])});
},DT*1000);

srv.listen(process.env.PORT||3000,()=>console.log('Doodle Turf on :'+(process.env.PORT||3000)));
