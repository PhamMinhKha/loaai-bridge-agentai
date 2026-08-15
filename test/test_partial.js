import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:8888/ws");
const SR = 16000;
function sineChunk(freq=440, ms=200){
  const n=(SR*ms)/1000; const b=Buffer.alloc(n*2); const v=new Int16Array(b.buffer,b.byteOffset,n);
  for(let i=0;i<n;i++) v[i]=Math.sin(2*Math.PI*freq*i/SR)*0x7000; return b;
}
ws.on("open",()=>{
  ws.send(JSON.stringify({type:"hello",device_id:"partial-001",token:"x"}));
  setTimeout(()=>{
    ws.send(JSON.stringify({type:"audio_start",format:"pcm16",sample_rate:SR}));
    let el=0; const iv=setInterval(()=>{ ws.send(sineChunk()); el+=200; if(el>=2000) clearInterval(iv); },200);
  },300);
});
ws.on("message",d=>{ const m=JSON.parse(d.toString()); console.log("SERVER:",JSON.stringify(m)); });
ws.on("error",e=>console.log("ERR",e.message));
setTimeout(()=>{ ws.close(); process.exit(0); }, 20000);
