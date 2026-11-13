/* Department Wins: tiny local server. No database, no dependencies.
   Saves to data/<dept>/deck.json and img/<dept>/*. Run: node server.js
   Writes are allowed from localhost, or from anywhere if ADMIN_KEY is set (sent as x-admin-key). */
const http=require("http"),fs=require("fs"),path=require("path");
const ROOT=__dirname,PORT=process.env.PORT||3000,KEY=process.env.ADMIN_KEY||"";
const MIME={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",".json":"application/json;charset=utf-8",".webp":"image/webp",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".svg":"image/svg+xml"};
const idRe=/^[a-z0-9][a-z0-9-]{0,40}$/,fileRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(webp|png|jpe?g|gif|svg)$/i;
const PUBLIC=new Set(["data","img","index.html","admin.html","icons.js"]);
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(obj))};
const authed=req=>{if(KEY)return req.headers["x-admin-key"]===KEY;const a=req.socket.remoteAddress||"";return a==="127.0.0.1"||a==="::1"||a==="::ffff:127.0.0.1"};
const readBody=(req,max)=>new Promise((ok,no)=>{const c=[];let n=0;req.on("data",d=>{n+=d.length;if(n>max){no(new Error("too large"));req.destroy()}else c.push(d)});req.on("end",()=>ok(Buffer.concat(c)));req.on("error",no)});
const wjson=(f,o)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,1))};
const validDeck=d=>d&&typeof d==="object"&&Array.isArray(d.projects)&&Array.isArray(d.slides)&&d.meta&&d.categories;

async function api(req,res,u){
  const p=u.pathname.split("/").filter(Boolean).slice(1),m=req.method;
  if(p[0]==="ping")return send(res,200,{ok:true,key:!!KEY,canWrite:authed(req)});
  if(p[0]==="img"&&m==="GET"&&idRe.test(p[1]||"")){
    const dir=path.join(ROOT,"img",p[1]);
    return send(res,200,fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>fileRe.test(f)).sort():[]);
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
    if(p[0]==="dept"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const df=path.join(ROOT,"data","departments.json"),list=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[];
      if(!list.some(x=>x.id===p[1]))return send(res,404,{error:"unknown department"});
      if(list.length<2)return send(res,400,{error:"Hindi pwedeng burahin ang huling department."});
      for(const base of ["data","img"]){const dir=path.join(ROOT,base,p[1]);if(dir.startsWith(path.join(ROOT,base)+path.sep)&&fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})}
      wjson(df,list.filter(x=>x.id!==p[1]));return send(res,200,{ok:true});
    }
    if(p[0]==="dept"&&m==="POST"){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      const df=path.join(ROOT,"data","departments.json"),list=fs.existsSync(df)?JSON.parse(fs.readFileSync(df)):[];
      if(list.some(x=>x.id===b.id))return send(res,409,{error:"department exists"});
      list.push({id:b.id,name:b.deck.meta.dept||b.id,company:b.deck.meta.company||""});
      fs.mkdirSync(path.join(ROOT,"img",b.id),{recursive:true});
      wjson(path.join(ROOT,"data",b.id,"deck.json"),b.deck);wjson(df,list);return send(res,200,{ok:true});
    }
    if(p[0]==="img"&&idRe.test(p[1]||"")&&fileRe.test(p[2]||"")){
      const f=path.join(ROOT,"img",p[1],p[2]);
      if(m==="POST"){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,await readBody(req,25e6));return send(res,200,{ok:true})}
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
}).listen(PORT,()=>console.log(`Department Wins  → http://localhost:${PORT}/   admin → http://localhost:${PORT}/admin`));
