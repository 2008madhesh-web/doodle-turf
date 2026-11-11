// Doodle Turf - authoritative server. Territory lives on an NxN grid; players move freely on it.
const express=require('express'),http=require('http'),{Server}=require('socket.io');
const app=express(),srv=http.createServer(app),io=new Server(srv);
app.use(express.static(__dirname+'/public'));
const N=64,C=N*N,SPD=5,TURN=4,DT=.05,BOTS=+(process.env.BOTS??4);
const own=new Uint8Array(C),trl=new Uint8Array(C),P=new Map();let dirty=true,tk=0,lb=[];
const ci=(x,y)=>(y|0)*N+(x|0);
const free=()=>{for(let i=1;i<251;i++)if(!P.has(i))return i};

function spawn(p){ // 3x3 home turf in the emptiest spot we can find
  for(let t=0;t<60;t++){
    const x=(3+Math.random()*(N-6))|0,y=(3+Math.random()*(N-6))|0;let ok=1;
    for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++)if(own[(y+j)*N+x+i])ok=0;
    if(ok||t==59){for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)own[(y+j)*N+x+i]=p.id;
      Object.assign(p,{x:x+.5,y:y+.5,hx:x+.5,hy:y+.5,a:Math.random()*6.28,w:0,alive:1,trail:[]});p.ta=p.a;dirty=1;return}
  }
}
function kill(p,by){
  if(!p.alive)return;p.alive=0;
  for(const c of p.trail)trl[c]=0;p.trail=[];
  for(let i=0;i<C;i++)if(own[i]==p.id)own[i]=0;
  dirty=1;if(by)by.kills++;
  if(p.sock)p.sock.emit('dead',{by:by?by.name:null});else setTimeout(()=>P.has(p.id)&&spawn(p),2500);
}
function close(p){ // trail -> territory, then fill everything the loop encloses
  for(const c of p.trail){trl[c]=0;own[c]=p.id}p.trail=[];
  const seen=new Uint8Array(C),q=[],push=i=>{if(!seen[i]&&own[i]!=p.id){seen[i]=1;q.push(i)}};
  for(let i=0;i<N;i++){push(i);push(C-N+i);push(i*N);push(i*N+N-1)}
  while(q.length){const i=q.pop(),x=i%N;if(x>0)push(i-1);if(x<N-1)push(i+1);if(i>=N)push(i-N);if(i<C-N)push(i+N)}
  for(let i=0;i<C;i++)if(!seen[i])own[i]=p.id; // unreachable from outside = enclosed
  dirty=1;
}
function step(p){
  // turning has inertia: angular velocity eases toward the wanted turn rate
  const d=Math.atan2(Math.sin(p.ta-p.a),Math.cos(p.ta-p.a));
  p.w+=(Math.max(-TURN,Math.min(TURN,d*8))-p.w)*.3;p.a+=p.w*DT;
  const o=ci(p.x,p.y); // walls: slide along the edge instead of dying
  p.x=Math.min(N-.01,Math.max(0,p.x+Math.cos(p.a)*SPD*DT));
  p.y=Math.min(N-.01,Math.max(0,p.y+Math.sin(p.a)*SPD*DT));
  const c=ci(p.x,p.y);if(c==o)return;
  const t=trl[c];
  if(t){if(t==p.id){kill(p);return}const q=P.get(t);if(q)kill(q,p)} // cut someone's tail = they die
  if(own[c]==p.id){if(p.trail.length)close(p)}else{trl[c]=p.id;p.trail.push(c);dirty=1}
}
function ai(p){
  p.ta+=(Math.random()-.5)*2.2;
  if(p.trail.length>14)p.ta=Math.atan2(p.hy-p.y,p.hx-p.x);
  if(p.x<4||p.x>N-4||p.y<4||p.y>N-4)p.ta=Math.atan2(N/2-p.y,N/2-p.x);
}
for(let i=0;i<BOTS;i++){const id=free(),p={id,name:['Bubbles','Waffle','Noodle','Pickle','Mochi'][i%5],hue:(i*77+20)%360,bot:1,kills:0};P.set(id,p);spawn(p)}

io.on('connection',s=>{let p;
  s.emit('init',{N});
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
    const cnt={};for(let i=0;i<C;i++)if(own[i])cnt[own[i]]=(cnt[own[i]]||0)+1;
    for(const p of P.values())p.score=cnt[p.id]||0;
    lb=[...P.values()].filter(p=>p.alive).sort((a,b)=>b.score-a.score).slice(0,5).map(p=>[p.name,Math.round(p.score*1000/C)/10,p.hue]);
  }
  io.volatile.emit('st',{lb,p:[...P.values()].filter(p=>p.alive).map(p=>[p.id,p.name,p.hue,+p.x.toFixed(2),+p.y.toFixed(2),+p.a.toFixed(2),p.score||0])});
  if(dirty){dirty=false;const b=Buffer.alloc(2*C);b.set(own,0);b.set(trl,C);io.emit('g',b)}
},DT*1000);

srv.listen(process.env.PORT||3000,()=>console.log('Doodle Turf on :'+(process.env.PORT||3000)));
