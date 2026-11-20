/* StoriDeck serverless API — same routes as server.js, backed by the GitHub repo.
   Every write becomes ONE git commit (blobs -> tree -> commit -> ref update).
   Env: GITHUB_TOKEN (repo contents read/write), GITHUB_REPO=owner/name,
        GITHUB_BRANCH (default main), ADMIN_KEY (required for writes). */
const REPO=process.env.GITHUB_REPO||"",BRANCH=process.env.GITHUB_BRANCH||"main";
const TOKEN=process.env.GITHUB_TOKEN||"",KEY=process.env.ADMIN_KEY||"";
const idRe=/^[a-z0-9][a-z0-9-]{0,40}$/,fileRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(webp|png|jpe?g|gif|svg)$/i,vidRe=/^[a-z0-9][a-z0-9._-]{0,100}\.(mp4|webm|mov|m4v)$/i;
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(obj))};
const authed=req=>!!KEY&&req.headers["x-admin-key"]===KEY;
const readBody=(req,max)=>new Promise((ok,no)=>{const c=[];let n=0;req.on("data",d=>{n+=d.length;if(n>max){no(new Error("too large"));req.destroy()}else c.push(d)});req.on("end",()=>ok(Buffer.concat(c)));req.on("error",no)});
const validDeck=d=>d&&typeof d==="object"&&Array.isArray(d.projects)&&Array.isArray(d.slides)&&d.meta&&d.categories;
const b64=b=>Buffer.from(b).toString("base64");
const unb64=s=>Buffer.from(String(s).replace(/\n/g,""),"base64");

async function gh(path,opts={}){
  if(!REPO||!TOKEN)throw new Error("github not configured");
  const r=await fetch("https://api.github.com/repos/"+REPO+path,{...opts,headers:{Authorization:"Bearer "+TOKEN,"User-Agent":"storideck-admin","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(opts.headers||{})}});
  if(r.status===404)return null;
  if(!r.ok){const t=await r.text().catch(()=>"");const e=new Error("github "+r.status+" "+t.slice(0,160));e.status=r.status;throw e}
  if(r.status===204)return null;
  const t=await r.text();try{return JSON.parse(t)}catch(e){return t}
}

/* ---- repo tree cache (path -> blob sha) ---- */
let _tree=null,_treeAt=0;
async function tree(){
  if(_tree&&Date.now()-_treeAt<15000)return _tree;
  const t=await gh(`/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`);
  _tree=new Map();for(const e of (t&&t.tree)||[])if(e.type==="blob")_tree.set(e.path,e.sha);
  _treeAt=Date.now();return _tree;
}
const invalidate=()=>{_tree=null;_treeAt=0};
async function list(prefix){const m=await tree();return[...m.keys()].filter(k=>k.startsWith(prefix))}
async function readBlob(path){
  const f=await gh(`/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  if(!f||f.type!=="file")return null;
  if(f.encoding==="base64"&&f.content)return unb64(f.content);
  if(f.sha){const b=await gh(`/git/blobs/${f.sha}`);if(b&&b.content)return unb64(b.content)}
  return null;
}
const readJson=async p=>{const b=await readBlob(p);return b?JSON.parse(b.toString()):null};

/* ---- one commit for many file changes. data:null = delete ---- */
async function commit(message,changes){
  changes=(changes||[]).filter(Boolean);if(!changes.length)return;
  const m=await tree(),items=[];
  const put=async c=>{
    if(c.data==null){if(m.has(c.path))items.push({path:c.path,mode:"100644",type:"blob",sha:null});return}
    const b=await gh(`/git/blobs`,{method:"POST",body:JSON.stringify({content:b64(c.data),encoding:"base64"})});
    items.push({path:c.path,mode:"100644",type:"blob",sha:b.sha});
  };
  for(let i=0;i<changes.length;i+=10)await Promise.all(changes.slice(i,i+10).map(put));
  if(!items.length)return;
  const ref=await gh(`/git/ref/heads/${encodeURIComponent(BRANCH)}`);
  const head=await gh(`/git/commits/${ref.object.sha}`);
  const t=await gh(`/git/trees`,{method:"POST",body:JSON.stringify({base_tree:head.tree.sha,tree:items})});
  const cm=await gh(`/git/commits`,{method:"POST",body:JSON.stringify({message,tree:t.sha,parents:[ref.object.sha]})});
  await gh(`/git/refs/heads/${encodeURIComponent(BRANCH)}`,{method:"PATCH",body:JSON.stringify({sha:cm.sha})});
  invalidate();
}
const wj=o=>Buffer.from(JSON.stringify(o,null,1));
const deckDirs=id=>[`data/${id}/`,`img/${id}/`,`vid/${id}/`];
const preSwap=pre=>{const base=pre.slice(0,-1),parent=base.slice(0,base.lastIndexOf("/"));return parent+"/"};
async function delDeck(changes,id){for(const pre of deckDirs(id))for(const k of await list(pre))changes.push({path:k,data:null})}
async function copyDeck(changes,oldId,newId){
  for(const pre of deckDirs(oldId)){
    const files=await list(pre),np=preSwap(pre)+newId+"/";
    for(let i=0;i<files.length;i+=8)await Promise.all(files.slice(i,i+8).map(async old=>{
      const data=await readBlob(old);if(data)changes.push({path:np+old.slice(pre.length),data});
    }));
  }
}
async function readProjects(){return (await readJson("data/projects.json"))||[]}
async function readDepts(){return (await readJson("data/departments.json"))||[]}
async function scrubDeck(changes,id){
  const l=await readProjects();
  changes.push({path:"data/projects.json",data:wj(l.map(p=>({...p,decks:(p.decks||[]).filter(d=>d.id!==id)})))});
  const dl=await readDepts();if(dl.length>1)changes.push({path:"data/departments.json",data:wj(dl.filter(x=>x.id!==id))});
}

async function api(req,res,u){
  const p=u.pathname.split("/").filter(Boolean).slice(1),m=req.method;
  const configured=!!(REPO&&TOKEN);
  if(p[0]==="ping")return send(res,200,{ok:true,key:!!KEY,canWrite:configured&&authed(req)});
  if(!configured)return send(res,503,{error:"github not configured"});
  if(p[0]==="img"&&m==="GET"&&idRe.test(p[1]||"")){
    const pre=`img/${p[1]}/`;
    return send(res,200,(await list(pre)).map(k=>k.slice(pre.length)).filter(f=>fileRe.test(f)).sort());
  }
  if(p[0]==="vid"&&m==="GET"&&idRe.test(p[1]||"")){
    const pre=`vid/${p[1]}/`;
    return send(res,200,(await list(pre)).map(k=>k.slice(pre.length)).filter(f=>vidRe.test(f)).sort());
  }
  if(p[0]==="file"&&m==="GET"){
    const path=decodeURIComponent(p.slice(1).join("/"));
    if(!/^data\/[a-z0-9][a-z0-9._/-]*\.json$/.test(path)||path.includes(".."))return send(res,404,{error:"not found"});
    const b=await readBlob(path);
    if(!b)return send(res,404,{error:"not found"});
    res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
    return res.end(b);
  }
  if(m==="GET")return send(res,404,{error:"not found"});
  if(!authed(req))return send(res,401,{error:"unauthorized"});
  try{
    if(p[0]==="deck"&&m==="PUT"&&idRe.test(p[1]||"")){
      const d=JSON.parse((await readBody(req,5e6)).toString());
      if(!validDeck(d))return send(res,400,{error:"invalid deck"});
      const m0=await tree();
      if(!m0.has(`data/${p[1]}/deck.json`))return send(res,404,{error:"unknown department"});
      const changes=[{path:`data/${p[1]}/deck.json`,data:wj(d)}];
      const dl=await readDepts(),de=dl.find(x=>x.id===p[1]);
      if(de&&d.meta&&((d.meta.dept&&de.name!==d.meta.dept)||(d.meta.company!=null&&de.company!==d.meta.company))){
        de.name=d.meta.dept||de.name;de.company=d.meta.company;changes.push({path:"data/departments.json",data:wj(dl)});}
      const pl=await readProjects();let ch=false;
      pl.forEach(pr=>{const dk=(pr.decks||[]).find(x=>x.id===p[1]);if(dk&&d.meta){if(d.meta.dept&&dk.name!==d.meta.dept){dk.name=d.meta.dept;ch=true}if(d.meta.company!=null&&dk.company!==d.meta.company){dk.company=d.meta.company;ch=true}}});
      if(ch)changes.push({path:"data/projects.json",data:wj(pl)});
      await commit(`deck ${p[1]}: save`,changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="departments"&&m==="PUT"){
      const b=JSON.parse((await readBody(req,1e6)).toString());
      const cur=await readDepts(),by={};cur.forEach(x=>by[x.id]=x);
      const inList=Array.isArray(b)?b:b.list;if(!Array.isArray(inList))return send(res,400,{error:"invalid"});
      const out=[];inList.forEach(x=>{if(by[x.id]&&!out.some(o=>o.id===x.id))out.push({...by[x.id],include:x.include===false?false:true})});
      cur.forEach(x=>{if(!out.some(o=>o.id===x.id))out.push(x)});
      const changes=[{path:"data/departments.json",data:wj(out)}];
      if(!Array.isArray(b)&&b.options)changes.push({path:"data/playlist.json",data:wj(b.options)});
      await commit("playlist: update departments",changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="projects"&&m==="PUT"){
      const b=JSON.parse((await readBody(req,2e6)).toString());
      const list=Array.isArray(b)?b:b.projects;
      if(!Array.isArray(list))return send(res,400,{error:"invalid"});
      const out=list.filter(pr=>pr&&idRe.test(pr.id||"")).map(pr=>({id:pr.id,name:String(pr.name||pr.id),company:String(pr.company||""),updated:pr.updated||"",
        decks:(Array.isArray(pr.decks)?pr.decks:[]).filter(d=>d&&idRe.test(d.id||"")).map(d=>({id:d.id,name:String(d.name||d.id),company:String(d.company||""),include:d.include!==false}))}));
      const changes=[{path:"data/projects.json",data:wj(out)}];
      if(!Array.isArray(b)&&b.options)changes.push({path:"data/playlist.json",data:wj(b.options)});
      await commit("projects: update registry",changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="project"&&m==="POST"&&p[2]==="duplicate"&&idRe.test(p[1]||"")){
      const b=JSON.parse((await readBody(req,1e6)).toString());
      const l=await readProjects(),src=l.find(x=>x.id===p[1]);
      if(!src)return send(res,404,{error:"unknown project"});
      const slug=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-").slice(0,40);
      const m0=await tree();
      let nid=slug(b.name)||slug(src.name+" copy")||src.id+"-copy",k=2;
      while(l.some(x=>x.id===nid)||m0.has(`data/${nid}/deck.json`))nid=(slug(b.name)||src.id+"-copy")+"-"+k++;
      const changes=[],newDecks=[];
      for(const d of src.decks||[]){
        let did=d.id+"-copy";k=2;
        while(m0.has(`data/${did}/deck.json`))did=d.id+"-copy-"+k++;
        await copyDeck(changes,d.id,did);
        newDecks.push({id:did,name:d.name,company:d.company,include:d.include!==false});
      }
      l.push({id:nid,name:String(b.name||src.name+" copy"),company:src.company,updated:new Date().toISOString().slice(0,10),decks:newDecks});
      changes.push({path:"data/projects.json",data:wj(l)});
      await commit(`project: duplicate ${src.id} -> ${nid}`,changes);
      return send(res,200,{ok:true,project:l[l.length-1]});
    }
    if(p[0]==="project"&&m==="POST"&&p[1]===undefined){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      const m0=await tree(),l=await readProjects();
      if(m0.has(`data/${b.id}/deck.json`)||l.some(x=>x.id===b.id))return send(res,409,{error:"project exists"});
      l.push({id:b.id,name:b.name||b.deck.meta.dept||b.id,company:b.company||b.deck.meta.company||"",
        decks:[{id:b.id,name:b.deck.meta.dept||b.name||b.id,company:b.deck.meta.company||b.company||"",include:true}]});
      await commit(`project: create ${b.id}`,[{path:`data/${b.id}/deck.json`,data:wj(b.deck)},{path:"data/projects.json",data:wj(l)}]);
      return send(res,200,{ok:true});
    }
    if(p[0]==="project"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const l=await readProjects(),pr=l.find(x=>x.id===p[1]);
      if(!pr)return send(res,404,{error:"unknown project"});
      const changes=[],deckIds=(pr.decks||[]).map(d=>d.id);
      for(const id of deckIds)await delDeck(changes,id);
      const nl=l.filter(x=>x.id!==p[1]);
      for(const id of deckIds)nl.forEach(x=>{x.decks=(x.decks||[]).filter(d=>d.id!==id)});
      changes.push({path:"data/projects.json",data:wj(nl)});
      const dl=await readDepts();
      if(dl.length>1)changes.push({path:"data/departments.json",data:wj(dl.filter(x=>!deckIds.includes(x.id)))});
      await commit(`project: delete ${p[1]}`,changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="POST"&&p[1]===undefined){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      const m0=await tree();
      if(m0.has(`data/${b.id}/deck.json`))return send(res,409,{error:"deck exists"});
      await commit(`deck: create ${b.id}`,[{path:`data/${b.id}/deck.json`,data:wj(b.deck)}]);
      return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="POST"&&p[2]==="move"&&idRe.test(p[1]||"")){
      const b=JSON.parse((await readBody(req,1e6)).toString());
      const l=await readProjects(),target=l.find(x=>x.id===b.project);
      if(!target)return send(res,404,{error:"unknown project"});
      let meta=null;
      l.forEach(pr=>{const d=(pr.decks||[]).find(x=>x.id===p[1]);if(d)meta=d});
      if(!meta){const dk=await readJson(`data/${p[1]}/deck.json`);if(dk&&dk.meta)meta={id:p[1],name:dk.meta.dept||p[1],company:dk.meta.company||"",include:true}}
      const m0=await tree();
      if(!meta||!m0.has(`data/${p[1]}/deck.json`))return send(res,404,{error:"unknown deck"});
      l.forEach(pr=>{pr.decks=(pr.decks||[]).filter(d=>d.id!==p[1])});
      target.decks=target.decks||[];target.decks.push({id:p[1],name:meta.name,company:meta.company,include:meta.include!==false});target.updated=new Date().toISOString().slice(0,10);
      const changes=[{path:"data/projects.json",data:wj(l)}];
      const dl=await readDepts();
      if(b.project==="department-wins"){if(!dl.some(x=>x.id===p[1])){dl.push({id:p[1],name:meta.name,company:meta.company});changes.push({path:"data/departments.json",data:wj(dl)})}}
      else{const nl=dl.filter(x=>x.id!==p[1]);if(nl.length!==dl.length)changes.push({path:"data/departments.json",data:wj(nl)})}
      await commit(`deck: move ${p[1]} -> ${b.project}`,changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="deck"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const changes=[];await delDeck(changes,p[1]);await scrubDeck(changes,p[1]);
      await commit(`deck: delete ${p[1]}`,changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="dept"&&m==="DELETE"&&idRe.test(p[1]||"")){
      const dl=await readDepts();
      if(!dl.some(x=>x.id===p[1]))return send(res,404,{error:"unknown department"});
      if(dl.length<2)return send(res,400,{error:"Hindi pwedeng burahin ang huling department."});
      const changes=[];await delDeck(changes,p[1]);
      changes.push({path:"data/departments.json",data:wj(dl.filter(x=>x.id!==p[1]))});
      await commit(`dept: delete ${p[1]}`,changes);
      return send(res,200,{ok:true});
    }
    if(p[0]==="dept"&&m==="POST"){
      const b=JSON.parse((await readBody(req,5e6)).toString());
      if(!idRe.test(b.id||"")||!validDeck(b.deck))return send(res,400,{error:"invalid"});
      const dl=await readDepts(),m0=await tree();
      if(dl.some(x=>x.id===b.id)||m0.has(`data/${b.id}/deck.json`))return send(res,409,{error:"department exists"});
      dl.push({id:b.id,name:b.deck.meta.dept||b.id,company:b.deck.meta.company||""});
      await commit(`dept: create ${b.id}`,[{path:`data/${b.id}/deck.json`,data:wj(b.deck)},{path:"data/departments.json",data:wj(dl)}]);
      return send(res,200,{ok:true});
    }
    if(p[0]==="img"&&idRe.test(p[1]||"")&&fileRe.test(p[2]||"")){
      const path=`img/${p[1]}/${p[2]}`;
      if(m==="POST"){const data=await readBody(req,25e6);await commit(`img: upload ${p[1]}/${p[2]}`,[{path,data}]);return send(res,200,{ok:true})}
      if(m==="DELETE"){await commit(`img: delete ${p[1]}/${p[2]}`,[{path,data:null}]);return send(res,200,{ok:true})}
    }
    if(p[0]==="vid"&&idRe.test(p[1]||"")&&vidRe.test(p[2]||"")){
      const path=`vid/${p[1]}/${p[2]}`;
      if(m==="POST"){const data=await readBody(req,200e6);await commit(`vid: upload ${p[1]}/${p[2]}`,[{path,data}]);return send(res,200,{ok:true})}
      if(m==="DELETE"){await commit(`vid: delete ${p[1]}/${p[2]}`,[{path,data:null}]);return send(res,200,{ok:true})}
    }
  }catch(e){return send(res,400,{error:String(e.message||e)})}
  send(res,404,{error:"not found"});
}
module.exports=async(req,res)=>{const u=new URL(req.url||"/","http://x");return api(req,res,u)};
