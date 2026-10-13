/** The dashboard is one self-contained page; no build step, no external assets. */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eminiar</title>
<style>
:root{--bg:#f6f7f9;--fg:#1b1f24;--muted:#6b7280;--card:#fff;--line:#e5e7eb;--accent:#2563eb;--ok:#16a34a;--bad:#dc2626;--bar:#93c5fd}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e5e7eb;--muted:#9ca3af;--card:#171a21;--line:#262a33;--accent:#60a5fa;--ok:#4ade80;--bad:#f87171;--bar:#1d4ed8}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:16px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0}
header h1{font-size:16px;margin:0 8px 0 0}header select{max-width:340px}
nav{display:flex;gap:4px;margin-left:auto}nav button{background:none;border:1px solid transparent;color:var(--muted);padding:6px 10px;border-radius:6px;cursor:pointer}
nav button.active{color:var(--fg);border-color:var(--line);background:var(--bg)}
main{padding:20px;max-width:1200px;margin:0 auto}section{display:none}section.active{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.card h3{margin:0 0 6px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.big{font-size:26px;font-weight:600}.sub{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
input,select,button,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:7px 10px}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.row input[type=text]{flex:1;min-width:200px}
.hit{padding:10px 0;border-bottom:1px solid var(--line)}.hit .t{font-weight:600}.hit pre{white-space:pre-wrap;margin:6px 0 0;font-size:12.5px;color:var(--fg);opacity:.9}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border:1px solid var(--line);border-radius:999px;color:var(--muted);margin-right:6px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.bars{display:flex;align-items:flex-end;gap:3px;height:60px}.bars div{flex:1;background:var(--bar);border-radius:2px 2px 0 0;min-width:4px}
.muted{color:var(--muted)}pre.json{font-size:12px;white-space:pre-wrap;margin:0}a{color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>eminiar</h1>
  <select id="project"></select>
  <nav>
    <button data-tab="overview" class="active">Overview</button>
    <button data-tab="search">Search</button>
    <button data-tab="memories">Memories</button>
    <button data-tab="graph">Graph</button>
    <button data-tab="events">Session</button>
    <button data-tab="doctor">Doctor</button>
  </nav>
</header>
<main>
<section id="overview" class="active">
  <div class="grid" id="kpis"></div>
  <div class="grid">
    <div class="card" style="grid-column:1/-1"><h3>tokens saved per day (30d)</h3><div class="bars" id="daily"></div><div class="sub" id="dailyLabel"></div></div>
  </div>
  <div class="grid">
    <div class="card"><h3>this session · by tool</h3><table id="sessionTools"></table></div>
    <div class="card"><h3>lifetime · by tool</h3><table id="lifeTools"></table></div>
    <div class="card"><h3>index</h3><table id="indexTable"></table></div>
  </div>
</section>
<section id="search">
  <div class="row"><input type="text" id="q" placeholder="search indexed outputs, files, docs, memories…"><select id="mode"><option value="hybrid">hybrid</option><option value="lexical">lexical</option><option value="semantic">semantic</option></select><button class="primary" id="go">Search</button></div>
  <div class="muted" id="searchMeta"></div><div id="hits"></div>
</section>
<section id="memories">
  <div class="row"><select id="mkind"><option>decision</option><option>constraint</option><option>fact</option><option>preference</option><option>todo</option><option>note</option><option>onboarding</option></select><input type="text" id="mname" placeholder="name (optional): topic/slug" style="max-width:220px"><input type="text" id="mcontent" placeholder="something worth remembering…"><button class="primary" id="madd">Remember</button></div>
  <div class="muted">Files under <code>.eminiar/memories/&lt;topic&gt;/&lt;name&gt;.md</code>; edit them by hand, they are re-imported automatically.</div>
  <table id="mtable"></table>
</section>
<section id="graph">
  <div class="row"><input type="text" id="gnode" placeholder="file path, path#Symbol or name"><select id="gmode"><option value="impact">impact</option><option value="dependencies">dependencies</option><option value="neighbors">neighbors</option><option value="find">find</option><option value="hotspots">hotspots</option><option value="coupled">coupled</option><option value="orphans">orphans</option></select><button class="primary" id="ggo">Query</button></div>
  <div id="gout"></div>
</section>
<section id="events"><table id="etable"></table></section>
<section id="doctor"><table id="dtable"></table></section>
</main>
<script>
const $=s=>document.querySelector(s);let root=new URLSearchParams(location.search).get('root')||'';
const api=(p,o)=>fetch(p+(p.includes('?')?'&':'?')+'root='+encodeURIComponent(root),o).then(r=>r.json());
const fmt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n);
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('section').forEach(s=>s.classList.toggle('active',s.id===b.dataset.tab));load(b.dataset.tab)});
async function projects(){const p=await api('/api/projects');const sel=$('#project');sel.innerHTML='';const seen=new Set();for(const x of [{root:p.current},...p.projects]){if(!x.root||seen.has(x.root))continue;seen.add(x.root);const o=document.createElement('option');o.value=x.root;o.textContent=x.root;if(x.root===p.current)o.selected=true;sel.appendChild(o)}sel.onchange=()=>{root=sel.value;history.replaceState(null,'','?root='+encodeURIComponent(root));load(document.querySelector('nav .active').dataset.tab)}}
function toolTable(el,rows){el.innerHTML='<tr><th>tool</th><th class=num>calls</th><th class=num>seen</th><th class=num>returned</th><th class=num>saved</th></tr>'+rows.sort((a,b)=>b.raw_chars-a.raw_chars).map(r=>{const s=Math.ceil(r.raw_chars/4),t=Math.ceil(r.returned_chars/4);return '<tr><td>'+esc(r.tool)+'</td><td class=num>'+r.calls+'</td><td class=num>'+fmt(s)+'</td><td class=num>'+fmt(t)+'</td><td class=num>'+fmt(Math.max(0,s-t))+'</td></tr>'}).join('')||'<tr><td class=muted>no calls yet</td></tr>'}
async function overview(){const s=await api('/api/stats');const k=[['session saved',fmt(s.session.savedTokens),Math.round(s.session.efficiency*100)+'% efficient · '+s.session.calls+' calls'],['project saved',fmt(s.projectTotals.savedTokens),s.projectTotals.calls+' calls'],['lifetime saved',fmt(s.lifetime.savedTokens),Math.round(s.lifetime.efficiency*100)+'% efficient · '+s.lifetime.calls+' calls'],['documents',s.index.documents,s.index.vectors+' vectors · '+s.index.memories+' memories'],['graph',s.index.graph.nodes+' nodes',s.index.graph.edges+' edges']];$('#kpis').innerHTML=k.map(([h,v,sub])=>'<div class=card><h3>'+h+'</h3><div class=big>'+v+'</div><div class=sub>'+esc(sub)+'</div></div>').join('');const max=Math.max(1,...s.daily.map(d=>d.saved_chars));$('#daily').innerHTML=s.daily.map(d=>'<div title="'+d.day+': '+fmt(Math.ceil(d.saved_chars/4))+' tokens" style="height:'+Math.max(2,100*d.saved_chars/max)+'%"></div>').join('');$('#dailyLabel').textContent=s.daily.length?s.daily[0].day+' → '+s.daily[s.daily.length-1].day:'no data yet';toolTable($('#sessionTools'),s.session.tools);toolTable($('#lifeTools'),s.lifetime.tools);$('#indexTable').innerHTML=Object.entries(s.index.bySource).map(([k,v])=>'<tr><td>'+k+'</td><td class=num>'+v+'</td></tr>').join('')}
async function search(){const q=$('#q').value.trim();if(!q)return;$('#searchMeta').textContent='searching…';const r=await api('/api/search?q='+encodeURIComponent(q)+'&mode='+$('#mode').value+'&limit=15');$('#searchMeta').textContent=r.hits.length+' hits · rankers: '+(r.used.join(', ')||'none')+(r.corrections.length?' · corrected: '+r.corrections.map(c=>c.from+'→'+c.to).join(', '):'');$('#hits').innerHTML=r.hits.map(h=>'<div class=hit><span class=tag>'+esc(h.source)+'</span><span class=tag>doc '+h.doc+'</span>'+(h.lines?'<span class=tag>L'+h.lines+'</span>':'')+'<span class=tag>'+h.score.toFixed(3)+'</span><span class="t">'+esc(h.title)+'</span><pre>'+esc(h.snippet)+'</pre></div>').join('')||'<div class=muted>no matches</div>'}
$('#go').onclick=search;$('#q').onkeydown=e=>{if(e.key==='Enter')search()};
async function memories(){const m=await api('/api/memories');$('#mtable').innerHTML='<tr><th>updated</th><th>kind</th><th>name</th><th>memory</th><th></th></tr>'+m.map(x=>'<tr><td class=muted>'+new Date(x.updated_at).toISOString().slice(0,10)+'</td><td><span class=tag>'+esc(x.kind)+'</span></td><td><a href="#" data-read="'+esc(x.name)+'">'+esc(x.name)+'</a></td><td>'+esc(x.content.split('\\n')[0].slice(0,160))+'</td><td><button data-del="'+esc(x.name)+'">✕</button></td></tr>').join('')||'<tr><td class=muted>no memories yet</td></tr>';document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(confirm('Delete memory '+b.dataset.del+' (and its file)?')){await api('/api/memories?name='+encodeURIComponent(b.dataset.del),{method:'DELETE'});memories()}});document.querySelectorAll('[data-read]').forEach(a=>a.onclick=async e=>{e.preventDefault();const r=await api('/api/memories?name='+encodeURIComponent(a.dataset.read));alert(r.name+' ['+r.kind+'] '+r.path+'\\n\\n'+r.body)})}
$('#madd').onclick=async()=>{const content=$('#mcontent').value.trim();if(!content)return;const r=await api('/api/memories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:$('#mkind').value,content,name:$('#mname').value.trim()||undefined})});if(r.error){alert(r.error);return}$('#mcontent').value='';$('#mname').value='';memories()};
async function graph(){const mode=$('#gmode').value;const r=await api('/api/graph?mode='+mode+'&node='+encodeURIComponent($('#gnode').value.trim())+'&limit=40');const el=$('#gout');if(r.error){el.innerHTML='<div class=bad>'+esc(r.error)+'</div>';return}if(r.rows){el.innerHTML='<table>'+r.rows.map(x=>'<tr>'+(typeof x==='string'?'<td>'+esc(x)+'</td>':Object.values(x).map(v=>'<td>'+esc(typeof v==='number'?(Number.isInteger(v)?v:v.toFixed(2)):v)+'</td>').join(''))+'</tr>').join('')+'</table>';return}if(r.edges){el.innerHTML='<div class=muted>'+esc(r.root)+'</div><table>'+r.edges.map(e=>'<tr><td>'+esc(e.src)+'</td><td><span class=tag>'+esc(e.kind)+'</span></td><td>'+esc(e.dst)+'</td></tr>').join('')+'</table>';return}el.innerHTML='<div class=muted>'+esc(r.root)+'</div><table><tr><th>node</th><th class=num>score</th><th>why</th></tr>'+r.hits.map(h=>'<tr><td>'+esc(h.label)+'</td><td class=num>'+h.score.toFixed(2)+'</td><td class=muted>'+esc(h.reasons.join('; '))+'</td></tr>').join('')+'</table>'}
$('#ggo').onclick=graph;$('#gnode').onkeydown=e=>{if(e.key==='Enter')graph()};
async function events(){const e=await api('/api/events?limit=150');$('#etable').innerHTML='<tr><th>time</th><th>category</th><th>tool</th><th>payload</th></tr>'+e.map(x=>'<tr><td class=muted>'+new Date(x.ts).toLocaleTimeString()+'</td><td><span class=tag>P'+x.priority+'</span>'+esc(x.category)+'</td><td>'+esc(x.tool||'')+'</td><td><pre class=json>'+esc(JSON.stringify(x.payload).slice(0,300))+'</pre></td></tr>').join('')||'<tr><td class=muted>no events yet</td></tr>'}
async function doctor(){$('#dtable').innerHTML='<tr><td class=muted>running checks…</td></tr>';const d=await api('/api/doctor');$('#dtable').innerHTML=d.map(c=>'<tr><td class="'+(c.ok?'ok':'bad')+'">'+(c.ok?'✓':'✗')+'</td><td>'+esc(c.name)+'</td><td>'+esc(c.detail)+'</td></tr>').join('')}
function load(tab){({overview,search:()=>{},memories,graph:()=>{if($('#gnode').value||['hotspots','coupled','orphans'].includes($('#gmode').value))graph()},events,doctor})[tab]()}
projects().then(()=>load('overview'));
</script>
</body>
</html>`;
