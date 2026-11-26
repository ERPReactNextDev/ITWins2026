/* StoriDeck: tiny local server. No database, no dependencies.
   Saves to data/<dept>/deck.json and img/<dept>/*. Run: node server.js
   Writes are allowed from localhost, or from anywhere if ADMIN_KEY is set (sent as x-admin-key). */
const http=require("http"),fs=require("fs"),path=require("path");
const ROOT=__dirname,PORT=process.env.PORT||3000,KEY=process.env.ADMIN_KEY||"";
const MIME={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",".json":"application/json;charset=utf-8",".webp":"image/webp",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".svg":"image/svg+xml",".mp4":"video/mp4",".webm":"video/webm",".mov":"video/quicktime",".m4v":"video/x-m4v",".mp3":"audio/mpeg",".wav":"audio/wav",".ogg":"audio/ogg",".m4a":"audio/mp4",".aac":"audio/aac",".flac":"audio/flac"};
const idRe=/^[a-z0-9][a-z0-9-]{0,40}$/,fileRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(webp|png|jpe?g|gif|svg)$/i,vidRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(mp4|webm|mov|m4v)$/i,musRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const PUBLIC=new Set(["data","img","vid","music","index.html","admin.html","icons.js"]);
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(obj))};
const authed=req=>{if(KEY)return req.headers["x-admin-key"]===KEY;const a=req.socket.remoteAddress||"";return a==="127.0.0.1"||a==="::1"||a==="::ffff:127.0.0.1"};
const readBody=(req,max)=>new Promise((ok,no)=>{const c=[];let n=0;req.on("data",d=>{n+=d.length;if(n>max){no(new Error("too large"));req.destroy()}else c.push(d)});req.on("end",()=>ok(Buffer.concat(c)));req.on("error",no)});
const wjson=(f,o)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,1))};
const validDeck=d=>d&&typeof d==="object"&&Array.isArray(d.projects)&&Array.isArray(d.slides)&&d.meta&&d.categories;
const PJ=path.join(ROOT,"data","projects.json");
const readProjects=()=>{try{return JSON.parse(fs.readFileSync(PJ))}catch(e){return[]}};
const writeProjects=l=>wjson(PJ,l);
const scrubDeck=id=>{ // remove a deck id from projects.json and departments.json
  try{writeProjects(readProjects().map(p=>({...p,decks:(p.decks||[]).filter(d=>d.id!==id)})))}catch(e){}
  try{const df=path.join(ROOT,"data","departments.json");if(fs.existsSync(df)){const l=JSON.parse(fs.readFileSync(df));if(l.length>1)wjson(df,l.filter(x=>x.id!==id))}}catch(e){}
};

async function api(req,res,u){
  const p=u.pathname.split("/").filter(Boolean).slice(1),m=req.method;
  if(p[0]==="ping")return send(res,200,{ok:true,key:!!KEY,canWrite:authed(req)});
  if(p[0]==="img"&&m==="GET"&&idRe.test(p[1]||"")){
    const dir=path.join(ROOT,"img",p[1]);
    const byDate=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>fileRe.test(f)).map(f=>{try{return[f,fs.statSync(path.join(dir,f)).mtimeMs]}catch(e){return[f,0]}}).sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])).map(x=>x[0]):[];
    return send(res,200,byDate);
  }
  if(p[0]==="vid"&&m==="GET"&&idRe.test(p[1]||"")){
    const dir=path.join(ROOT,"vid",p[1]);
    return send(res,200,fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>vidRe.test(f)).sort():[]);
  }
  if(p[0]==="music"&&m==="GET"&&idRe.test(p[1]||"")){
    const dir=path.join(ROOT,"music",p[1]);
    return send(res,200,fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>musRe.test(f)).sort():[]);
  }
  if(m==="GET")return send(res,404,{error:"not found"});
  if(!authed(req))return send(res,401,{error:"unauthorized"});
  try{
    if(p[0]==="deck"&&m==="PUT"&&idRe.test(p[1]||"")){
      const d=JSON.parse((await readBody(req,5e6)).toString());
      if(!validDeck(d))return send(res,400,{error:"invalid deck"});
      if(!fs.existsSync(path.join(ROOT,"data",p[1])))return send(res,404,{error:"unknown department"});
      wjson(path.join(ROOT,"data",p[1],"deck.json"),d);
      try{const df=path.join(ROOT,"data","departments.json"),l=JSON.parse(fs.readFileSync(df)),e=l.find(x=>x.id===p[1]);
        if(e&&d.meta&&((d.meta.dept&&e.name!==d.meta.dept)||(d.meta.company!=null&&e.company!==d.meta.company))){e.name=d.meta.dept||e.name;e.company=d.meta.company;wjson(df,l)}}catch(e){}
      try{const l=readProjects();let ch=false;l.forEach(pr=>{const dk=(pr.decks||[]).find(x=>x.id===p[1]);if(dk&&d.meta){if(d.meta.dept&&dk.name!==d.meta.dept){dk.name=d.meta.dept;ch=true}if(d.meta.company!=null&&dk.company!==d.meta.company){dk.company=d.meta.company;ch=true}}});if(ch)writeProjects(l)}catch(e){}
      return send(res,200,{ok:true});
    }
    if(p[0]==="departments"&&m==="PUT"){
      /* playlist order + include flags + options. Body: {list:[{id,include}], options:{...}} or a plain array */
      const b=JSON.parse((await readBody(req,1e6)).toString()),df=path.join(ROOT,"data","departments.json");
      const cur=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[],by={};cur.forEach(x=>by[x.id]=x);
      const inList=Array.isArray(b)?b:b.list;if(!Array.isArray(inList))return send(res,400,{error:"invalid"});
      const out=[];inList.forEach(x=>{if(by[x.id]&&!out.some(o=>o.id===x.id)){out.push({...by[x.id],include:x.include===false?false:true})}});
      cur.forEach(x=>{if(!out.some(o=>o.id===x.id))out.push(x)});
      wjson(df,out);
      if(!Array.isArray(b)&&b.options)wjson(path.join(ROOT,"data","playlist.json"),b.options);
      return send(res,200,{ok:true});
    }
    if(p[0]==="projects"&&m==="PUT"){
      const b=JSON.parse((await readBody(req,2e6)).toString());
      const list=Array.isArray(b)?b:b.projects;
      if(!Array.isArray(list))return send(res,400,{error:"invalid"});
      const out=list.filter(pr=>pr&&idRe.test(pr.id||"")).map(pr=>({id:pr.id,name:String(pr.name||pr.id),company:String(pr.company||""),updated:pr.updated||"",
        music:(Array.isArray(pr.music)?pr.music:[]).filter(f=>musRe.test(f)),
        decks:(Array.isArray(pr.decks)?pr.decks:[]).filter(d=>d&&idRe.test(d.id||"")).map(d=>({id:d.id,name:String(d.name||d.id),company:String(d.company||""),include:d.include!==false}))}));
      writeProjects(out);
      if(!Array.isArray(b)&&b.options)wjson(path.join(ROOT,"data","playlist.json"),b.options);
      return send(res,200,{ok:true});
    }
    if(p[0]==="project"&&m==="POST"&&p[2]==="duplicate"&&idRe.test(p[1]||"")){
      const b=JSON.parse((await readBody(req,1e6)).toString());
      const l=readProjects(),src=l.find(x=>x.id===p[1]);
      if(!src)return send(res,404,{error:"unknown project"});
      const slug=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-").slice(0,40);
      let nid=slug(b.name)||slug(src.name+" copy")||src.id+"-copy",k=2;
      while(l.some(x=>x.id===nid)||fs.existsSync(path.join(ROOT,"data",nid,"deck.json")))nid=(slug(b.name)||src.id+"-copy")+"-"+k++;
      const copyDir=(from,to)=>{if(!fs.existsSync(from))return;fs.mkdirSync(to,{recursive:true});for(const f of fs.readdirSync(from)){const s=path.join(from,f),d=path.join(to,f);fs.statSync(s).isDirectory()?copyDir(s,d):fs.copyFileSync(s,d)}};
      const newDecks=[];
      for(const d of src.decks||[]){
        let did=d.id+"-copy";k=2;
        while(fs.existsSync(path.join(ROOT,"data",did,"deck.json")))did=d.id+"-copy-"+k++;
        for(const base of ["data","img","vid","music"]){const from=path.join(ROOT,base,d.id),to=path.join(ROOT,base,did);if(from.startsWith(path.join(ROOT,base)+path.sep))copyDir(from,to)}
        newDecks.push({id:did,name:d.name,company:d.company,include:d.include!==false});
      }
      {const from=path.join(ROOT,"music",src.id),to=path.join(ROOT,"music",nid);if(from.startsWith(path.join(ROOT,"music")+path.sep))copyDir(from,to)}
      const np={id:nid,name:String(b.name||src.name+" copy"),company:src.company,updated:new Date().toISOString().slice(0,10),music:Array.isArray(src.music)?src.music:[],decks:newDecks};
      l.push(np);writeProjects(l);return send(res,200,{ok:true,project:np});
    }
    if(p[0]==="project"&&m==="POST"&&p[1]===undefined){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      if(fs.existsSync(path.join(ROOT,"data",b.id,"deck.json")))return send(res,409,{error:"project exists"});
      const l=readProjects();if(l.some(x=>x.id===b.id))return send(res,409,{error:"project exists"});
      for(const base of ["img","vid","music"])fs.mkdirSync(path.join(ROOT,base,b.id),{recursive:true});
      wjson(path.join(ROOT,"data",b.id,"deck.json"),b.deck);
      l.push({id:b.id,name:b.name||b.deck.meta.dept||b.id,company:b.company||b.deck.meta.company||"",
        decks:[{id:b.id,name:b.deck.meta.dept||b.name||b.id,company:b.deck.meta.company||b.company||"",include:true}]});
      writeProjects(l);return send(res,200,{ok:true});
    }
    if(p[0]==="project"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const l=readProjects(),pr=l.find(x=>x.id===p[1]);
      if(!pr)return send(res,404,{error:"unknown project"});
      for(const d of pr.decks||[])for(const base of ["data","img","vid","music"]){const dir=path.join(ROOT,base,d.id);if(dir.startsWith(path.join(ROOT,base)+path.sep)&&fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})}
      {const dir=path.join(ROOT,"music",pr.id);if(dir.startsWith(path.join(ROOT,"music")+path.sep)&&fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})}
      writeProjects(l.filter(x=>x.id!==p[1]));
      for(const d of pr.decks||[])scrubDeck(d.id);
      return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="POST"&&p[1]===undefined){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      if(fs.existsSync(path.join(ROOT,"data",b.id,"deck.json")))return send(res,409,{error:"deck exists"});
      for(const base of ["img","vid","music"])fs.mkdirSync(path.join(ROOT,base,b.id),{recursive:true});
      wjson(path.join(ROOT,"data",b.id,"deck.json"),b.deck);return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="POST"&&p[2]==="move"&&idRe.test(p[1]||"")){
      const b=JSON.parse((await readBody(req,1e6)).toString());
      const l=readProjects(),target=l.find(x=>x.id===b.project);
      if(!target)return send(res,404,{error:"unknown project"});
      let meta=null;
      l.forEach(pr=>{const d=(pr.decks||[]).find(x=>x.id===p[1]);if(d)meta=d});
      if(!meta){try{const dk=JSON.parse(fs.readFileSync(path.join(ROOT,"data",p[1],"deck.json")));meta={id:p[1],name:dk.meta.dept||p[1],company:dk.meta.company||"",include:true}}catch(e){}}
      if(!meta||!fs.existsSync(path.join(ROOT,"data",p[1],"deck.json")))return send(res,404,{error:"unknown deck"});
      l.forEach(pr=>{pr.decks=(pr.decks||[]).filter(d=>d.id!==p[1])});
      target.decks=target.decks||[];target.decks.push({id:p[1],name:meta.name,company:meta.company,include:meta.include!==false});target.updated=new Date().toISOString().slice(0,10);
      writeProjects(l);
      try{const df=path.join(ROOT,"data","departments.json"),dl=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[];
        if(b.project==="department-wins"){if(!dl.some(x=>x.id===p[1])){dl.push({id:p[1],name:meta.name,company:meta.company});wjson(df,dl)}}
        else{const nl=dl.filter(x=>x.id!==p[1]);if(nl.length!==dl.length)wjson(df,nl)}}catch(e){}
      return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="DELETE"&&idRe.test(p[1]||"")){
      for(const base of ["data","img","vid","music"]){const dir=path.join(ROOT,base,p[1]);if(dir.startsWith(path.join(ROOT,base)+path.sep)&&fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})}
      scrubDeck(p[1]);return send(res,200,{ok:true});
    }
    if(p[0]==="dept"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const df=path.join(ROOT,"data","departments.json"),list=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[];
      if(!list.some(x=>x.id===p[1]))return send(res,404,{error:"unknown department"});
      if(list.length<2)return send(res,400,{error:"Hindi pwedeng burahin ang huling department."});
      for(const base of ["data","img","vid","music"]){const dir=path.join(ROOT,base,p[1]);if(dir.startsWith(path.join(ROOT,base)+path.sep)&&fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})}
      wjson(df,list.filter(x=>x.id!==p[1]));return send(res,200,{ok:true});
    }
    if(p[0]==="dept"&&m==="POST"){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      const df=path.join(ROOT,"data","departments.json"),list=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[];
      if(list.some(x=>x.id===b.id))return send(res,409,{error:"department exists"});
      list.push({id:b.id,name:b.deck.meta.dept||b.id,company:b.deck.meta.company||""});
      for(const base of ["img","vid","music"])fs.mkdirSync(path.join(ROOT,base,b.id),{recursive:true});
      wjson(path.join(ROOT,"data",b.id,"deck.json"),b.deck);wjson(df,list);return send(res,200,{ok:true});
    }
    if(p[0]==="img"&&idRe.test(p[1]||"")&&fileRe.test(p[2]||"")){
      const f=path.join(ROOT,"img",p[1],p[2]);
      if(m==="POST"){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await readBody(req,25e6));return send(res,200,{ok:true})}
      if(m==="DELETE"){if(fs.existsSync(f))fs.unlinkSync(f);return send(res,200,{ok:true})}
    }
    if(p[0]==="vid"&&idRe.test(p[1]||"")&&vidRe.test(p[2]||"")){
      const f=path.join(ROOT,"vid",p[1],p[2]);
      if(m==="POST"){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await readBody(req,200e6));return send(res,200,{ok:true})}
      if(m==="DELETE"){if(fs.existsSync(f))fs.unlinkSync(f);return send(res,200,{ok:true})}
    }
    if(p[0]==="music"&&idRe.test(p[1]||"")&&musRe.test(p[2]||"")){
      const f=path.join(ROOT,"music",p[1],p[2]);
      if(m==="POST"){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await readBody(req,200e6));return send(res,200,{ok:true})}
      if(m==="DELETE"){if(fs.existsSync(f))fs.unlinkSync(f);return send(res,200,{ok:true})}
    }
  }catch(e){return send(res,400,{error:String(e.message||e)})}
  send(res,404,{error:"not found"});
}

http.createServer((req,res)=>{
  const u=new URL(req.url,"http://x");let p=decodeURIComponent(u.pathname);
  if(p.startsWith("/api/"))return api(req,res,u);
  if(p==="/")p="/index.html";else if(p==="/admin")p="/admin.html";
  else if(/^\/[a-z0-9-]+$/.test(p)&&!fs.existsSync(path.join(ROOT,p)))p="/index.html"; // /hr, /it ... -> viewer
  const f=path.normalize(path.join(ROOT,p));
  if(!f.startsWith(ROOT+path.sep)||!PUBLIC.has(path.relative(ROOT,f).split(path.sep)[0])||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("Not found")}
  const json=f.endsWith(".json");
  res.writeHead(200,{"Content-Type":MIME[path.extname(f).toLowerCase()]||"application/octet-stream","Cache-Control":json||f.endsWith(".html")?"no-cache":"public, max-age=3600"});
  fs.createReadStream(f).pipe(res);
}).listen(PORT,()=>console.log(`StoriDeck  → http://localhost:${PORT}/   admin → http://localhost:${PORT}/admin`));
