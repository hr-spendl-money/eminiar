/**
 * The dashboard is one self-contained page: no build step, no external assets.
 * The client script lives inside this template literal, so it must not use
 * backticks or "${"; string escapes are doubled (see NL below).
 */
const CSS = `
:root{--bg:#f5f6f8;--fg:#1b1f24;--muted:#6b7280;--card:#fff;--line:#e5e7eb;--accent:#2563eb;--accent-soft:#dbeafe;--ok:#16a34a;--bad:#dc2626;--warn:#d97706;--bar:#93c5fd;--code:#f1f3f5}
@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e5e7eb;--muted:#9ca3af;--card:#171a21;--line:#262a33;--accent:#60a5fa;--accent-soft:#1e3a5f;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;--bar:#1d4ed8;--code:#0b0d11}}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:14px;align-items:center;padding:10px 20px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
header h1{font-size:16px;margin:0;letter-spacing:.02em}header h1 span{color:var(--accent)}header select{max-width:360px}
nav{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}nav button{background:none;border:1px solid transparent;color:var(--muted);padding:6px 10px;border-radius:6px;cursor:pointer}
nav button.active{color:var(--fg);border-color:var(--line);background:var(--bg)}nav button:hover{color:var(--fg)}
main{padding:20px;max-width:1400px;margin:0 auto}section{display:none}section.active{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.grid.two{grid-template-columns:1fr 1fr}.grid.wide{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
@media(max-width:900px){.grid.two,.grid.wide,.split{grid-template-columns:1fr!important}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}
.card h3{margin:0 0 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:8px}
.card h3 .right{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400}
.big{font-size:26px;font-weight:600;line-height:1.2}.sub{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.click{cursor:pointer}tr.click:hover td{background:var(--bg)}tr.sel td{background:var(--accent-soft)}
input,select,button,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:7px 10px}
button{cursor:pointer}button:hover{border-color:var(--accent)}button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.danger{color:var(--bad);border-color:var(--bad)}button.sm{padding:3px 8px;font-size:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}.row input[type=text]{flex:1;min-width:180px}.row label{color:var(--muted);font-size:12px;display:flex;gap:4px;align-items:center}
.hit{padding:10px 0;border-bottom:1px solid var(--line)}.hit .t{font-weight:600}.hit pre{white-space:pre-wrap;margin:6px 0 0;font-size:12.5px;opacity:.9}
.tag{display:inline-block;font-size:11px;padding:1px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);margin-right:5px;white-space:nowrap}
.tag.k-decision{color:#7c3aed;border-color:#7c3aed}.tag.k-constraint{color:#dc2626;border-color:#dc2626}.tag.k-fact{color:#2563eb;border-color:#2563eb}.tag.k-preference{color:#0d9488;border-color:#0d9488}.tag.k-todo{color:#d97706;border-color:#d97706}.tag.k-note{color:#6b7280}.tag.k-onboarding{color:#16a34a;border-color:#16a34a}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}
.bars{display:flex;align-items:flex-end;gap:3px;height:70px}.bars div{flex:1;background:var(--bar);border-radius:2px 2px 0 0;min-width:4px}
pre.json,pre.log{font-size:12px;white-space:pre-wrap;margin:0;word-break:break-word}pre.log{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:10px;max-height:420px;overflow:auto}
a{color:var(--accent);cursor:pointer;text-decoration:none}a:hover{text-decoration:underline}code{background:var(--code);padding:1px 4px;border-radius:4px;font-size:12.5px}
.split{display:grid;grid-template-columns:minmax(280px,1fr) minmax(0,2fr);gap:12px}
.mlist{max-height:70vh;overflow:auto}.mitem{padding:9px 10px;border-bottom:1px solid var(--line);cursor:pointer;border-left:3px solid transparent}.mitem:hover{background:var(--bg)}.mitem.sel{border-left-color:var(--accent);background:var(--accent-soft)}
.mitem .n{font-weight:600;font-size:13px;word-break:break-all}.mitem .p{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
textarea{width:100%;min-height:320px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.field{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}.field label{font-size:12px;color:var(--muted)}.field input,.field select{width:100%}
.gwrap{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;height:620px}
.gwrap svg{width:100%;height:100%;display:block;cursor:grab}.gwrap svg.drag{cursor:grabbing}
.legend{position:absolute;left:10px;bottom:10px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:11px;display:flex;gap:10px;flex-wrap:wrap;max-width:80%}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.ghint{position:absolute;right:10px;top:10px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;max-width:45%}
.node text{font-size:10px;fill:var(--fg);pointer-events:none;paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round}
.node circle{stroke:var(--card);stroke-width:1.5px;cursor:pointer}.node.root circle{stroke:var(--fg);stroke-width:2.5px}.node.dim{opacity:.25}.edge.dim{opacity:.08}
.edge{fill:none;stroke-opacity:.45}.edge.imports{stroke:#2563eb}.edge.calls{stroke:#16a34a;stroke-dasharray:4 3}.edge.co_changes{stroke:#f59e0b;stroke-dasharray:1 3;stroke-width:2}.edge.mentions{stroke:#db2777;stroke-dasharray:5 3}.edge.defines,.edge.exports{stroke:#9ca3af}.edge.references{stroke:#0ea5e9;stroke-dasharray:2 2}.edge.extends,.edge.implements{stroke:#7c3aed}.edge.authored{stroke:#d97706;stroke-dasharray:3 3}
.toast{position:fixed;right:16px;bottom:16px;background:var(--fg);color:var(--bg);padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;z-index:9;max-width:420px}
.toast.show{opacity:1}.toast.bad{background:var(--bad);color:#fff}
.kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12.5px}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-all}
.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:16px}.actions .card p{margin:0 0 10px;color:var(--muted);font-size:12.5px}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px}@keyframes s{to{transform:rotate(360deg)}}
.empty{color:var(--muted);padding:20px;text-align:center}
`;

const HTML = `
<header>
  <h1><span>em</span>iniar</h1>
  <select id="project" title="project"></select>
  <nav>
    <button data-tab="overview" class="active">Overview</button>
    <button data-tab="memories">Memories</button>
    <button data-tab="graph">Graph</button>
    <button data-tab="search">Search</button>
    <button data-tab="sessions">Sessions</button>
    <button data-tab="actions">Actions</button>
    <button data-tab="doctor">Doctor</button>
  </nav>
</header>
<main>

<section id="overview" class="active">
  <div class="grid" id="kpis"></div>
  <div class="grid wide">
    <div class="card"><h3>tokens saved per day <span class="right" id="dailyLabel"></span></h3><div class="bars" id="daily"></div></div>
    <div class="card"><h3>system</h3><dl class="kv" id="sysinfo"></dl></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>this session · by tool</h3><table id="sessionTools"></table></div>
    <div class="card"><h3>lifetime · by tool</h3><table id="lifeTools"></table></div>
  </div>
  <div class="grid">
    <div class="card"><h3>index by source</h3><table id="indexTable"></table></div>
    <div class="card"><h3>graph by kind</h3><table id="graphKinds"></table></div>
    <div class="card" style="grid-column:span 2"><h3>recent sessions <a class="right" data-goto="sessions">all →</a></h3><table id="recentSessions"></table></div>
  </div>
</section>

<section id="memories">
  <div class="row">
    <button class="primary" id="mnew">+ New memory</button>
    <input type="text" id="mfilter" placeholder="filter by name, tag or text…">
    <select id="mkindf"><option value="">all kinds</option></select>
    <select id="mtopicf"><option value="">all topics</option></select>
    <button id="mreconcile" title="re-import files edited by hand">↻ Reconcile</button>
    <span class="muted" id="mmeta"></span>
  </div>
  <div class="split">
    <div class="card" style="padding:0"><div class="mlist" id="mlist"></div></div>
    <div class="card" id="meditor"><div class="empty">Select a memory, or create a new one.</div></div>
  </div>
</section>

<section id="graph">
  <div class="row">
    <select id="gmode">
      <option value="map">project map</option>
      <option value="subgraph">neighbourhood</option>
      <option value="impact">impact (who depends on it)</option>
      <option value="dependencies">dependencies (what it uses)</option>
      <option value="find">find nodes</option>
      <option value="hotspots">hotspots</option>
      <option value="coupled">co-changing pairs</option>
      <option value="orphans">orphans</option>
    </select>
    <input type="text" id="gnode" placeholder="file path, path#Symbol, memory:name or a name" list="gnodes">
    <datalist id="gnodes"></datalist>
    <label>depth <select id="gdepth"><option>1</option><option selected>2</option><option>3</option></select></label>
    <label>limit <select id="glimit"><option>40</option><option>80</option><option selected>120</option><option>200</option><option>400</option></select></label>
    <label><input type="checkbox" id="gco" checked> co-changes</label>
    <button class="primary" id="ggo">Draw</button>
    <button id="gfit">Fit</button>
  </div>
  <div class="split" style="grid-template-columns:minmax(0,3fr) minmax(280px,1fr)">
    <div class="gwrap"><svg id="gsvg"></svg><div class="legend" id="glegend"></div><div class="ghint" id="ghint">Click a node to focus it, drag to move, scroll to zoom.</div></div>
    <div class="card" style="max-height:620px;overflow:auto"><h3 id="gside-title">results</h3><div id="gside"></div></div>
  </div>
</section>

<section id="search">
  <div class="row"><input type="text" id="q" placeholder="search indexed outputs, files, docs, memories, code…"><select id="smode"><option value="hybrid">hybrid</option><option value="lexical">lexical</option><option value="semantic">semantic</option></select><select id="ssource"><option value="">any source</option><option>exec</option><option>batch</option><option>file</option><option>url</option><option>code</option><option>memory</option><option>session</option></select><button class="primary" id="go">Search</button></div>
  <div class="muted" id="searchMeta"></div><div id="hits"></div>
</section>

<section id="sessions">
  <div class="split">
    <div class="card" style="padding:0"><div class="mlist" id="slist"></div></div>
    <div class="card"><h3 id="stitle">events</h3><div class="row"><select id="ecat"><option value="">all categories</option></select><label>limit <select id="elimit"><option>100</option><option>300</option><option>1000</option></select></label></div><table id="etable"></table></div>
  </div>
</section>

<section id="actions">
  <div class="actions">
    <div class="card"><h3>reindex</h3><p>Rebuild the code graph, git signals, docs, memories or embeddings. Incremental unless full.</p>
      <div class="row"><select id="ascope"><option>all</option><option>code</option><option>git</option><option>docs</option><option>memories</option><option>embeddings</option></select><label><input type="checkbox" id="afull"> full</label><button class="primary" data-act="reindex">Run</button></div></div>
    <div class="card"><h3>index a path</h3><p>Index files or a directory into search (markdown by default; pass globs for other files).</p>
      <div class="row"><input type="text" id="apath" placeholder="docs/ or README.md"><input type="text" id="aglob" placeholder="globs, comma separated" style="max-width:200px"><button class="primary" data-act="index">Index</button></div></div>
    <div class="card"><h3>embeddings</h3><p>Embed every chunk that still has no vector. Loads the model on first use.</p>
      <div class="row"><button class="primary" data-act="embed">Embed pending</button></div></div>
    <div class="card"><h3>memories</h3><p>Re-import memory files edited, added or removed by hand under <code id="amemdir"></code>.</p>
      <div class="row"><button class="primary" data-act="reconcile">Reconcile</button></div></div>
    <div class="card"><h3>doctor</h3><p>Check node, SQLite extensions, the model, sandbox languages, routing and the MCP server. Fix re-pins the stable copy and clears Claude Code's cached launch failure.</p>
      <div class="row"><button class="primary" data-act="doctor">Run</button><button data-act="doctor-fix">Run with --fix</button></div></div>
    <div class="card"><h3>purge</h3><p>Permanently delete project data. Memory files stay on disk and are re-imported.</p>
      <div class="row"><select id="pscope"><option>index</option><option>sessions</option><option>graph</option><option>memories</option><option>all</option></select><input type="text" id="pconfirm" placeholder='type "purge" to confirm' style="max-width:180px"><button class="danger" data-act="purge">Purge</button><button data-act="purge-fetch-cache" title="empty the 24h URL cache">Empty fetch cache</button></div></div>
  </div>
  <div class="card"><h3>action log <button class="sm right" id="aclear">clear</button></h3><pre class="log" id="alog">ready.</pre></div>
</section>

<section id="doctor">
  <div class="row"><button class="primary" id="drun">Re-run</button><button id="dfix">Run with --fix</button><span class="muted" id="dmeta"></span></div>
  <div class="card"><table id="dtable"></table></div>
</section>

</main>
<div class="toast" id="toast"></div>
`;

const JS = `
const NL=String.fromCharCode(10);
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
let root=new URLSearchParams(location.search).get('root')||'';
const api=(p,o)=>fetch(p+(p.includes('?')?'&':'?')+'root='+encodeURIComponent(root),o).then(async r=>{const j=await r.json().catch(()=>({error:'bad response'}));if(!r.ok&&!j.error)j.error='HTTP '+r.status;return j});
const post=(p,body,method)=>api(p,{method:method||'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const fmt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n|0);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago=ts=>{if(!ts)return '';const d=Date.now()-ts;if(d<6e4)return 'just now';if(d<36e5)return Math.round(d/6e4)+'m ago';if(d<864e5)return Math.round(d/36e5)+'h ago';return Math.round(d/864e5)+'d ago'};
const day=ts=>ts?new Date(ts).toISOString().slice(0,10):'';
let toastT;function toast(msg,bad){const t=$('#toast');t.textContent=msg;t.className='toast show'+(bad?' bad':'');clearTimeout(toastT);toastT=setTimeout(()=>t.className='toast',bad?5000:2500)}
function kindTag(k){return '<span class="tag k-'+esc(k)+'">'+esc(k)+'</span>'}
function showTab(tab){$$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$$('section').forEach(s=>s.classList.toggle('active',s.id===tab));history.replaceState(null,'','?root='+encodeURIComponent(root)+'#'+tab);load(tab)}
$$('nav button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
document.addEventListener('click',e=>{const a=e.target.closest('[data-goto]');if(a){e.preventDefault();showTab(a.dataset.goto)}});

/* ---------- projects ---------- */
async function projects(){const p=await api('/api/projects');if(!root)root=p.current;const sel=$('#project');sel.innerHTML='';const seen=new Set();for(const x of [{root:p.current},...p.projects]){if(!x.root||seen.has(x.root))continue;seen.add(x.root);const o=document.createElement('option');o.value=x.root;o.textContent=x.root;if(x.root===root)o.selected=true;sel.appendChild(o)}sel.onchange=()=>{root=sel.value;G.cache=null;showTab(document.querySelector('nav .active').dataset.tab)}}

/* ---------- overview ---------- */
function toolTable(el,rows){el.innerHTML='<tr><th>tool</th><th class=num>calls</th><th class=num>seen</th><th class=num>returned</th><th class=num>saved</th></tr>'+rows.sort((a,b)=>b.raw_chars-a.raw_chars).map(r=>{const s=Math.ceil(r.raw_chars/4),t=Math.ceil(r.returned_chars/4);return '<tr><td>'+esc(r.tool)+'</td><td class=num>'+r.calls+'</td><td class=num>'+fmt(s)+'</td><td class=num>'+fmt(t)+'</td><td class=num>'+fmt(Math.max(0,s-t))+'</td></tr>'}).join('')||'<tr><td class=muted colspan=5>no calls yet</td></tr>'}
async function overview(){const s=await api('/api/stats');if(s.error){toast(s.error,true);return}
const pct=x=>Math.round((x.efficiency||0)*100)+'%';
const k=[['session saved',fmt(s.session.savedTokens),pct(s.session)+' efficient · '+s.session.calls+' calls'],['project saved',fmt(s.projectTotals.savedTokens),pct(s.projectTotals)+' efficient · '+s.projectTotals.calls+' calls'],['lifetime saved',fmt(s.lifetime.savedTokens),pct(s.lifetime)+' efficient · '+s.lifetime.calls+' calls'],['documents',s.index.documents,s.index.vectors+' vectors'+(s.index.pendingEmbeddings?' · <span class=warn>backlog</span>':'')],['memories',s.index.memories,s.onboarding.length+'/4 onboarding'],['graph',s.index.graph.nodes+' nodes',s.index.graph.edges+' edges']];
$('#kpis').innerHTML=k.map(([h,v,sub])=>'<div class=card><h3>'+h+'</h3><div class=big>'+v+'</div><div class=sub>'+sub+'</div></div>').join('');
const max=Math.max(1,...s.daily.map(d=>d.saved_chars));$('#daily').innerHTML=s.daily.map(d=>'<div title="'+d.day+': '+fmt(Math.ceil(d.saved_chars/4))+' tokens, '+d.calls+' calls" style="height:'+Math.max(2,100*d.saved_chars/max)+'%"></div>').join('')||'<div class=muted>no data yet</div>';
$('#dailyLabel').textContent=s.daily.length?s.daily[0].day+' → '+s.daily[s.daily.length-1].day:'';
const miss=['overview','structure','commands','conventions'].filter(n=>!s.onboarding.includes(n));
$('#sysinfo').innerHTML=[['project',s.project],['database',s.dbPath],['routing',s.routing],['embeddings',s.index.embeddings],['memories dir',s.memoriesDir],['onboarding',miss.length?'<span class=warn>missing: '+miss.join(', ')+'</span> — run /eminiar:em-onboard':'<span class=ok>complete</span>'],['session',s.session.id]].map(([a,b])=>'<dt>'+a+'</dt><dd>'+(a==='onboarding'?b:esc(b))+'</dd>').join('');
toolTable($('#sessionTools'),s.session.tools);toolTable($('#lifeTools'),s.lifetime.tools);
$('#indexTable').innerHTML=Object.entries(s.index.bySource).filter(([,v])=>v).map(([k,v])=>'<tr><td>'+k+'</td><td class=num>'+v+'</td></tr>').join('')||'<tr><td class=muted>empty</td></tr>';
$('#graphKinds').innerHTML=Object.entries(s.index.graph.byKind||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<tr><td>'+esc(k)+'</td><td class=num>'+v+'</td></tr>').join('')||'<tr><td class=muted>empty — run reindex</td></tr>';
$('#recentSessions').innerHTML='<tr><th>started</th><th>session</th><th>last prompt</th><th class=num>calls</th><th class=num>saved</th></tr>'+s.sessions.map(x=>'<tr><td class=muted title="'+esc(new Date(x.started_at||0).toLocaleString())+'">'+ago(x.started_at)+(x.current?' <span class=tag>current</span>':'')+'</td><td><code>'+esc(String(x.id).slice(0,8))+'</code></td><td class=muted>'+esc((x.last_prompt||'').slice(0,90))+'</td><td class=num>'+x.calls+'</td><td class=num>'+fmt(x.savedTokens)+'</td></tr>').join('')||'<tr><td class=muted colspan=5>no sessions yet</td></tr>';
$('#amemdir').textContent=s.memoriesDir}

/* ---------- memories ---------- */
const M={all:[],sel:null,kinds:[]};
function mRender(){const f=$('#mfilter').value.trim().toLowerCase(),k=$('#mkindf').value,t=$('#mtopicf').value;
const rows=M.all.filter(m=>(!k||m.kind===k)&&(!t||m.topic===t)&&(!f||m.name.includes(f)||m.tags.some(x=>x.includes(f))||m.content.toLowerCase().includes(f)));
$('#mlist').innerHTML=rows.map(m=>'<div class="mitem'+(M.sel===m.name?' sel':'')+'" data-name="'+esc(m.name)+'"><div class=n>'+esc(m.name)+'</div><div class=p>'+kindTag(m.kind)+'<span class=muted>'+day(m.updated_at)+' · '+fmt(m.size||0)+'B</span></div><div class=p>'+esc(m.content.split(NL)[0].slice(0,120))+'</div></div>').join('')||'<div class=empty>no memories match</div>';
$('#mmeta').textContent=rows.length+' of '+M.all.length;
$$('.mitem').forEach(el=>el.onclick=()=>mOpen(el.dataset.name))}
async function memories(){const r=await api('/api/memories');if(r.error){toast(r.error,true);return}M.all=r.memories;M.kinds=r.kinds;
const kf=$('#mkindf'),tf=$('#mtopicf');const kv=kf.value,tv=tf.value;kf.innerHTML='<option value="">all kinds</option>'+r.kinds.map(k=>'<option>'+k+'</option>').join('');tf.innerHTML='<option value="">all topics</option>'+r.topics.map(k=>'<option>'+k+'</option>').join('');kf.value=kv;tf.value=tv;
if(r.gitignored)toast('.gitignore keeps '+r.dir+' out of git; memories stay local',true);
if(r.skipped.length)toast('skipped invalid memory files: '+r.skipped.join(', '),true);
mRender()}
['#mfilter','#mkindf','#mtopicf'].forEach(s=>$(s).oninput=mRender);
$('#mreconcile').onclick=async()=>{const r=await post('/api/actions',{action:'reconcile'});toast(r.output,!r.ok);memories()};
function mForm(m,isNew){const kinds=M.kinds.length?M.kinds:['decision','constraint','fact','preference','todo','note','onboarding'];
return '<div class=row style="margin-bottom:6px"><strong style="flex:1;word-break:break-all">'+(isNew?'New memory':esc(m.name))+'</strong>'+(isNew?'':'<button class=sm id="mrename">rename</button><button class="sm danger" id="mdel">delete</button>')+'</div>'+
(isNew?'<div class=field><label>name (topic/slug, optional — derived from kind + content)</label><input type=text id="fname" placeholder="auth/session-tokens"></div>':'<div class=muted style="font-size:12px;margin-bottom:8px">'+esc(m.path)+' · created '+esc(String(m.created).slice(0,10))+' · updated '+esc(String(m.updated).slice(0,10))+'</div>')+
'<div class="grid" style="grid-template-columns:1fr 2fr 2fr;gap:8px;margin-bottom:0"><div class=field><label>kind</label><select id="fkind">'+kinds.map(k=>'<option'+(k===m.kind?' selected':'')+'>'+k+'</option>').join('')+'</select></div><div class=field><label>tags (comma separated)</label><input type=text id="ftags" value="'+esc((m.tags||[]).join(', '))+'"></div><div class=field><label>related (file:path, sym:path#Name, mem:name)</label><input type=text id="frelated" value="'+esc((m.related||[]).join(', '))+'"></div></div>'+
'<div class=field><label>body (markdown)</label><textarea id="fbody">'+esc(m.body||'')+'</textarea></div>'+
'<div class=row><button class=primary id="msave">'+(isNew?'Create':'Save')+'</button><span class=muted id="mstatus"></span></div>'}
async function mOpen(name){const m=await api('/api/memories?name='+encodeURIComponent(name));if(m.error){toast(m.error,true);return}M.sel=name;mRender();$('#meditor').innerHTML=mForm(m,false);
$('#msave').onclick=async()=>{$('#mstatus').innerHTML='<span class=spin></span>';const r=await post('/api/memories?name='+encodeURIComponent(name),{kind:$('#fkind').value,content:$('#fbody').value,tags:$('#ftags').value,related:$('#frelated').value},'PUT');if(r.error){toast(r.error,true);$('#mstatus').textContent='';return}toast('saved '+r.name);await memories();mOpen(name)};
$('#mdel').onclick=async()=>{if(!confirm('Delete memory "'+name+'" and its file?'))return;const r=await api('/api/memories?name='+encodeURIComponent(name),{method:'DELETE'});if(r.error){toast(r.error,true);return}toast('deleted '+name);M.sel=null;$('#meditor').innerHTML='<div class=empty>Select a memory, or create a new one.</div>';memories()};
$('#mrename').onclick=async()=>{const to=prompt('New name (topic/slug):',name);if(!to||to===name)return;const r=await post('/api/memories?name='+encodeURIComponent(name),{to},'PATCH');if(r.error){toast(r.error,true);return}toast('renamed → '+r.name+(r.refsUpdated?' ('+r.refsUpdated+' references updated)':''));await memories();mOpen(r.name)}}
$('#mnew').onclick=()=>{M.sel=null;mRender();$('#meditor').innerHTML=mForm({kind:'fact',tags:[],related:[],body:''},true);$('#fbody').focus();
$('#msave').onclick=async()=>{const content=$('#fbody').value.trim();if(!content){toast('body required',true);return}$('#mstatus').innerHTML='<span class=spin></span>';const r=await post('/api/memories',{kind:$('#fkind').value,content,name:$('#fname').value.trim()||undefined,tags:$('#ftags').value,related:$('#frelated').value});if(r.error){toast(r.error,true);$('#mstatus').textContent='';return}toast('created '+r.name);await memories();mOpen(r.name)}};

/* ---------- graph ---------- */
const KIND_COLORS={file:'#2563eb',function:'#16a34a',method:'#0d9488',class:'#d97706',interface:'#7c3aed',type:'#8b5cf6',package:'#6b7280',memory:'#db2777',person:'#f59e0b',concept:'#0ea5e9',variable:'#64748b'};
const color=k=>KIND_COLORS[k]||'#94a3b8';
const short=n=>{if(n.kind==='file'||n.kind==='package'){const p=n.label.split('/');return p[p.length-1]}return n.label};
const G={nodes:[],edges:[],sim:null,view:{x:0,y:0,w:1000,h:620},cache:null,sel:null};
const svgEl=()=>$('#gsvg');
function gSetView(v){G.view=v;svgEl().setAttribute('viewBox',v.x+' '+v.y+' '+v.w+' '+v.h)}
function gFit(){if(!G.nodes.length)return;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const n of G.nodes){x0=Math.min(x0,n.x);y0=Math.min(y0,n.y);x1=Math.max(x1,n.x);y1=Math.max(y1,n.y)}const pad=60,w=Math.max(200,x1-x0+pad*2),h=Math.max(200,y1-y0+pad*2);const box=svgEl().getBoundingClientRect(),ar=box.width/box.height;let vw=w,vh=h;if(vw/vh<ar)vw=vh*ar;else vh=vw/ar;gSetView({x:(x0+x1)/2-vw/2,y:(y0+y1)/2-vh/2,w:vw,h:vh})}
$('#gfit').onclick=gFit;
function layout(nodes,edges,ticks){const n=nodes.length;if(!n)return;const idx=new Map(nodes.map((d,i)=>[d.id,i]));const R=Math.sqrt(n)*40;nodes.forEach((d,i)=>{if(d.x==null){const a=i/n*Math.PI*2;d.x=Math.cos(a)*R+(Math.random()-.5)*20;d.y=Math.sin(a)*R+(Math.random()-.5)*20}d.vx=0;d.vy=0});
const links=edges.map(e=>[idx.get(e.src),idx.get(e.dst),e.kind==='co_changes'?.4:1]).filter(l=>l[0]!=null&&l[1]!=null);
const deg=new Array(n).fill(0);for(const [a,b] of links){deg[a]++;deg[b]++}nodes.forEach((d,i)=>d.deg=deg[i]);
const k=38;let temp=Math.max(60,R/2);
for(let t=0;t<ticks;t++){for(let i=0;i<n;i++){const a=nodes[i];for(let j=i+1;j<n;j++){const b=nodes[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+.01;if(d2>90000)continue;const f=k*k/d2;dx*=f;dy*=f;a.vx+=dx;a.vy+=dy;b.vx-=dx;b.vy-=dy}}
for(const [i,j,s] of links){const a=nodes[i],b=nodes[j];const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+.01;const f=(d-k*2)/d*.05*s;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}
for(const d of nodes){if(d.fixed){d.vx=d.vy=0;continue}d.vx-=d.x*.004;d.vy-=d.y*.004;const v=Math.sqrt(d.vx*d.vx+d.vy*d.vy)||1;const lim=Math.min(v,temp);d.x+=d.vx/v*lim;d.y+=d.vy/v*lim;d.vx*=.4;d.vy*=.4}temp=Math.max(2,temp*.96)}}
function gDraw(){const svg=svgEl();const byId=new Map(G.nodes.map(n=>[n.id,n]));const focus=G.sel;const near=new Set();if(focus){near.add(focus);for(const e of G.edges){if(e.src===focus)near.add(e.dst);if(e.dst===focus)near.add(e.src)}}
const edges=G.edges.map(e=>{const a=byId.get(e.src),b=byId.get(e.dst);if(!a||!b)return '';const dim=focus&&!(near.has(e.src)&&near.has(e.dst))&&e.src!==focus&&e.dst!==focus;return '<line class="edge '+esc(e.kind)+(dim?' dim':'')+'" x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke-width="'+(e.kind==='co_changes'?1+e.weight*2:1)+'"'+(e.kind==='imports'||e.kind==='calls'||e.kind==='references'?' marker-end="url(#arr)"':'')+'><title>'+esc(e.kind+': '+a.label+' → '+b.label+(e.weight!==1?' ('+e.weight.toFixed(2)+')':''))+'</title></line>'}).join('');
const nodes=G.nodes.map(n=>{const r=4+Math.min(10,Math.sqrt(n.deg||0)*1.6)+(n.root?3:0);const dim=focus&&!near.has(n.id);return '<g class="node'+(n.root?' root':'')+(dim?' dim':'')+'" data-id="'+esc(n.id)+'" transform="translate('+n.x.toFixed(1)+','+n.y.toFixed(1)+')"><circle r="'+r+'" fill="'+color(n.kind)+'"><title>'+esc(n.kind+' '+n.label+(n.path&&n.kind!=='file'?' ('+n.path+')':'')+(n.commits?' · '+n.commits+' commits':''))+'</title></circle>'+(G.nodes.length<=220||n.root||(n.deg||0)>3||near.has(n.id)?'<text x="'+(r+3)+'" y="3.5">'+esc(short(n))+'</text>':'')+'</g>'}).join('');
svg.innerHTML='<defs><marker id="arr" viewBox="0 0 10 10" refX="14" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs><g id="gedges">'+edges+'</g><g id="gnodesg">'+nodes+'</g>';
const kinds=[...new Set(G.nodes.map(n=>n.kind))];const ek=[...new Set(G.edges.map(e=>e.kind))];$('#glegend').innerHTML=kinds.map(k=>'<span><i style="background:'+color(k)+'"></i>'+esc(k)+'</span>').join('')+(ek.length?'<span class=muted>|</span>':'')+ek.map(k=>'<span><svg width="18" height="8"><line class="edge '+esc(k)+'" x1="0" y1="4" x2="18" y2="4" stroke-width="2"></line></svg> '+esc(k)+'</span>').join('');
svg.querySelectorAll('.node').forEach(g=>{g.onclick=e=>{e.stopPropagation();gFocus(g.dataset.id)};g.ondblclick=e=>{e.stopPropagation();$('#gnode').value=g.dataset.id;$('#gmode').value='subgraph';graph()}})}
function gFocus(id){G.sel=G.sel===id?null:id;gDraw();const n=G.nodes.find(x=>x.id===id);if(!n)return;const ins=G.edges.filter(e=>e.dst===id),outs=G.edges.filter(e=>e.src===id);const lab=i=>{const m=G.nodes.find(x=>x.id===i);return m?esc(m.label):esc(i)};
$('#gside-title').innerHTML=esc(n.kind)+' <span class=right><a data-sub="'+esc(id)+'">explore →</a></span>';
$('#gside').innerHTML='<div style="word-break:break-all;font-weight:600;margin-bottom:6px">'+esc(n.label)+'</div>'+(n.path&&n.kind!=='file'?'<div class=muted style="font-size:12px">'+esc(n.path)+'</div>':'')+(n.commits?'<div class=muted style="font-size:12px">'+n.commits+' commits</div>':'')+
'<h3 style="margin-top:12px">incoming · '+ins.length+'</h3><table>'+ins.slice(0,60).map(e=>'<tr><td><span class=tag>'+esc(e.kind)+'</span></td><td><a data-focus="'+esc(e.src)+'">'+lab(e.src)+'</a></td></tr>').join('')+'</table>'+
'<h3 style="margin-top:12px">outgoing · '+outs.length+'</h3><table>'+outs.slice(0,60).map(e=>'<tr><td><span class=tag>'+esc(e.kind)+'</span></td><td><a data-focus="'+esc(e.dst)+'">'+lab(e.dst)+'</a></td></tr>').join('')+'</table>';
$$('#gside [data-focus]').forEach(a=>a.onclick=()=>gFocus(a.dataset.focus));$$('#gside-title [data-sub]').forEach(a=>a.onclick=()=>{$('#gnode').value=a.dataset.sub;$('#gmode').value='subgraph';graph()})}
function gAnimate(nodes,edges){G.nodes=nodes;G.edges=edges;G.sel=null;let t=0;const total=nodes.length>200?160:260;cancelAnimationFrame(G.sim);const step=()=>{layout(nodes,edges,nodes.length>200?3:6);t++;if(t%4===0||t>=total/6){gDraw();if(t===4)gFit()}if(t<total/6)G.sim=requestAnimationFrame(step);else{gDraw();gFit()}};G.sim=requestAnimationFrame(step)}
(function wire(){const svg=svgEl();let drag=null;const pt=e=>{const b=svg.getBoundingClientRect();return {x:G.view.x+(e.clientX-b.left)/b.width*G.view.w,y:G.view.y+(e.clientY-b.top)/b.height*G.view.h}};
svg.addEventListener('mousedown',e=>{const g=e.target.closest('.node');if(g){const n=G.nodes.find(x=>x.id===g.dataset.id);drag={node:n,moved:false};n.fixed=true}else drag={pan:pt(e),view:{...G.view}};svg.classList.add('drag')});
window.addEventListener('mousemove',e=>{if(!drag)return;if(drag.node){const p=pt(e);drag.node.x=p.x;drag.node.y=p.y;drag.moved=true;layout(G.nodes,G.edges,1);gDraw()}else{const p=pt(e);gSetView({...G.view,x:drag.view.x-(p.x-G.view.x-(drag.pan.x-drag.view.x)),y:drag.view.y-(p.y-G.view.y-(drag.pan.y-drag.view.y))})}});
window.addEventListener('mouseup',()=>{if(drag&&drag.node){drag.node.fixed=false}drag=null;svg.classList.remove('drag')});
svg.addEventListener('wheel',e=>{e.preventDefault();const p=pt(e);const f=e.deltaY>0?1.12:0.89;const v=G.view;gSetView({x:p.x-(p.x-v.x)*f,y:p.y-(p.y-v.y)*f,w:v.w*f,h:v.h*f})},{passive:false});
svg.addEventListener('click',e=>{if(!e.target.closest('.node')&&G.sel){G.sel=null;gDraw()}})})();
function gTable(html,title){$('#gside-title').textContent=title||'results';$('#gside').innerHTML=html}
async function graph(){const mode=$('#gmode').value,node=$('#gnode').value.trim(),limit=$('#glimit').value,depth=$('#gdepth').value;$('#ghint').innerHTML='<span class=spin></span> loading…';
if(['hotspots','coupled','orphans','find'].includes(mode)){const r=await api('/api/graph?mode='+mode+'&node='+encodeURIComponent(node)+'&limit='+limit);$('#ghint').textContent=mode;if(r.error){gTable('<div class=bad>'+esc(r.error)+'</div>');return}
const rows=r.rows||[];const link=id=>'<a data-sub="'+esc(id)+'">';
if(mode==='hotspots')gTable('<table><tr><th>file</th><th class=num>90d</th><th class=num>all</th><th>last</th></tr>'+rows.map(x=>'<tr><td>'+link('file:'+x.path)+esc(x.path)+'</a></td><td class=num>'+x.commits_90d+'</td><td class=num>'+x.commits+'</td><td class=muted>'+esc(x.last_touched)+'</td></tr>').join('')+'</table>','hotspots');
else if(mode==='coupled')gTable('<table><tr><th>a</th><th>b</th><th class=num>w</th><th class=num>n</th></tr>'+rows.map(x=>'<tr><td>'+link('file:'+x.a)+esc(x.a)+'</a></td><td>'+link('file:'+x.b)+esc(x.b)+'</a></td><td class=num>'+x.weight.toFixed(2)+'</td><td class=num>'+x.count+'</td></tr>').join('')+'</table>','co-changing pairs');
else if(mode==='orphans')gTable('<table>'+rows.map(x=>'<tr><td>'+link('file:'+x)+esc(x)+'</a></td></tr>').join('')+'</table>','orphans (nothing imports them)');
else gTable('<table>'+rows.map(x=>'<tr><td><span class=tag>'+esc(x.kind)+'</span></td><td>'+link(x.id)+esc(x.label)+'</a></td></tr>').join('')+'</table>'||'<div class=empty>no matches</div>','find: '+node);
$$('#gside [data-sub]').forEach(a=>a.onclick=()=>{$('#gnode').value=a.dataset.sub;$('#gmode').value='subgraph';graph()});
if(!G.nodes.length)drawMap();return}
if(mode==='map'){await drawMap();return}
if(!node){$('#ghint').textContent='enter a node first';return}
if(mode==='subgraph'){const r=await api('/api/graph?mode=subgraph&node='+encodeURIComponent(node)+'&depth='+depth+'&limit='+limit);if(r.error){$('#ghint').innerHTML='<span class=bad>'+esc(r.error)+'</span>';return}$('#ghint').innerHTML=esc(r.rootLabel)+' · '+r.nodes.length+' nodes, '+r.edges.length+' edges'+(r.truncated?' (truncated)':'');gAnimate(r.nodes,r.edges);gFocus(r.root);return}
const r=await api('/api/graph?mode='+mode+'&node='+encodeURIComponent(node)+'&limit='+limit);if(r.error){$('#ghint').innerHTML='<span class=bad>'+esc(r.error)+'</span>';return}
const rootN={id:r.root,label:r.rootLabel.replace(/^[a-z]+ /,''),kind:r.rootLabel.split(' ')[0],root:true,path:null};
const nodes=[rootN,...r.hits.map(h=>({id:h.id,label:h.label.replace(/^[a-z]+ /,'').replace(/ \\(.*\\)$/,''),kind:h.kind,path:null,score:h.score}))];
const edges=r.hits.map(h=>mode==='impact'?{src:h.id,dst:r.root,kind:h.reasons[0]?h.reasons[0].split(' ')[0].replace('co-changed','co_changes').replace('memory','mentions'):'references',weight:Math.min(1,h.score)}:{src:r.root,dst:h.id,kind:(h.reasons[0]||'imports').split(' ')[0],weight:Math.min(1,h.score)});
$('#ghint').innerHTML=esc(mode)+' of '+esc(r.rootLabel)+' · '+r.hits.length+' hits';gAnimate(nodes,edges);
gTable('<table><tr><th>node</th><th class=num>score</th></tr>'+r.hits.map(h=>'<tr><td><a data-focus="'+esc(h.id)+'">'+esc(h.label)+'</a><div class=muted style="font-size:11px">'+esc(h.reasons.join('; '))+'</div></td><td class=num>'+h.score.toFixed(2)+'</td></tr>').join('')+'</table>',mode+' · '+r.hits.length);
$$('#gside [data-focus]').forEach(a=>a.onclick=()=>gFocus(a.dataset.focus))}
async function drawMap(){const limit=$('#glimit').value,co=$('#gco').checked?'1':'0';const r=await api('/api/graph?mode=map&limit='+limit+'&cochanges='+co);if(r.error){$('#ghint').innerHTML='<span class=bad>'+esc(r.error)+'</span>';return}
$('#ghint').innerHTML='project map · '+r.nodes.length+' of '+r.total+' files, '+r.edges.length+' edges'+(r.nodes.length<r.total?' (top by degree; raise limit for more)':'');if(!r.nodes.length){$('#ghint').innerHTML='graph is empty — run <a data-goto="actions">reindex</a> first';return}
const deg=new Map();for(const e of r.edges){deg.set(e.src,(deg.get(e.src)||0)+1);deg.set(e.dst,(deg.get(e.dst)||0)+1)}
gAnimate(r.nodes,r.edges);
gTable('<table><tr><th>file</th><th class=num>deg</th></tr>'+[...r.nodes].sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0)).slice(0,80).map(n=>'<tr><td><a data-focus="'+esc(n.id)+'">'+esc(n.label)+'</a></td><td class=num>'+(deg.get(n.id)||0)+'</td></tr>').join('')+'</table>','files by degree');
$$('#gside [data-focus]').forEach(a=>a.onclick=()=>gFocus(a.dataset.focus))}
$('#ggo').onclick=graph;$('#gnode').onkeydown=e=>{if(e.key==='Enter')graph()};$('#gmode').onchange=()=>{const m=$('#gmode').value;if(['map','hotspots','coupled','orphans'].includes(m))graph()};
let gnT;$('#gnode').oninput=()=>{clearTimeout(gnT);const v=$('#gnode').value.trim();if(v.length<2)return;gnT=setTimeout(async()=>{const r=await api('/api/graph?mode=find&node='+encodeURIComponent(v)+'&limit=12');if(r.rows)$('#gnodes').innerHTML=r.rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join('')},200)};

/* ---------- search ---------- */
async function search(){const q=$('#q').value.trim();if(!q)return;$('#searchMeta').innerHTML='<span class=spin></span> searching…';const r=await api('/api/search?q='+encodeURIComponent(q)+'&mode='+$('#smode').value+'&limit=20'+($('#ssource').value?'&source='+$('#ssource').value:''));if(r.error){$('#searchMeta').innerHTML='<span class=bad>'+esc(r.error)+'</span>';return}
$('#searchMeta').textContent=r.hits.length+' hits · rankers: '+(r.used.join(', ')||'none')+(r.corrections.length?' · corrected: '+r.corrections.map(c=>c.from+'→'+c.to).join(', '):'');
$('#hits').innerHTML=r.hits.map(h=>'<div class=hit><span class=tag>'+esc(h.source)+'</span><span class=tag>doc '+h.doc+'</span>'+(h.lines?'<span class=tag>L'+h.lines+'</span>':'')+'<span class=tag>'+h.score.toFixed(3)+'</span><span class=tag>'+day(h.created)+'</span><span class=t>'+(h.source==='memory'?'<a data-mem="'+esc(h.title)+'">'+esc(h.title)+'</a>':esc(h.title))+'</span><pre>'+esc(h.snippet)+'</pre></div>').join('')||'<div class=empty>no matches</div>';
$$('#hits [data-mem]').forEach(a=>a.onclick=()=>{showTab('memories');memories().then(()=>mOpen(a.dataset.mem))})}
$('#go').onclick=search;$('#q').onkeydown=e=>{if(e.key==='Enter')search()};

/* ---------- sessions ---------- */
const S={sel:null};
async function sessions(){const r=await api('/api/sessions?limit=60');if(r.error){toast(r.error,true);return}
$('#slist').innerHTML=r.map(x=>'<div class="mitem'+(S.sel===x.id?' sel':'')+'" data-id="'+esc(x.id)+'"><div class=n><code>'+esc(String(x.id).slice(0,8))+'</code> '+(x.current?'<span class=tag>current</span>':'')+'<span class=muted style="float:right;font-weight:400">'+ago(x.started_at)+'</span></div><div class=p>'+esc((x.last_prompt||'(no prompt yet)').slice(0,100))+'</div><div class=p>'+x.calls+' calls · '+fmt(x.savedTokens)+' saved · '+Math.round((x.efficiency||0)*100)+'%'+(x.source?' · '+esc(x.source):'')+'</div></div>').join('')||'<div class=empty>no sessions yet</div>';
$$('#slist .mitem').forEach(el=>el.onclick=()=>{S.sel=el.dataset.id;sessions();events()});if(!S.sel&&r[0]){S.sel=r[0].id;sessions();events()}}
async function events(){const cat=$('#ecat').value,lim=$('#elimit').value;const e=await api('/api/events?limit='+lim+(S.sel?'&session='+encodeURIComponent(S.sel):'')+(cat?'&category='+encodeURIComponent(cat):''));if(e.error){toast(e.error,true);return}
$('#stitle').textContent='events · '+(S.sel?S.sel.slice(0,8):'all')+' · '+e.length;
const cats=[...new Set(e.map(x=>x.category))].sort();const cv=$('#ecat').value;$('#ecat').innerHTML='<option value="">all categories</option>'+cats.map(c=>'<option'+(c===cv?' selected':'')+'>'+esc(c)+'</option>').join('');
$('#etable').innerHTML='<tr><th>time</th><th>category</th><th>tool</th><th>payload</th></tr>'+e.map(x=>'<tr><td class=muted title="'+esc(new Date(x.ts).toLocaleString())+'">'+new Date(x.ts).toLocaleTimeString()+'</td><td><span class=tag>P'+x.priority+'</span>'+esc(x.category)+'</td><td>'+esc(x.tool||'')+'</td><td><pre class=json>'+esc(JSON.stringify(x.payload).slice(0,400))+'</pre></td></tr>').join('')||'<tr><td class=muted colspan=4>no events</td></tr>'}
$('#ecat').onchange=events;$('#elimit').onchange=events;

/* ---------- actions ---------- */
function alog(line,bad){const el=$('#alog');const ts=new Date().toLocaleTimeString();el.textContent=(el.textContent==='ready.'?'':el.textContent+NL+NL)+'['+ts+'] '+line;el.scrollTop=el.scrollHeight;if(bad)toast(line.split(NL)[0],true)}
$('#aclear').onclick=()=>{$('#alog').textContent='ready.'};
async function act(btn){const a=btn.dataset.act;let body={action:a};
if(a==='reindex')body={action:'reindex',scope:$('#ascope').value,full:$('#afull').checked};
if(a==='index'){body={action:'index',path:$('#apath').value,glob:$('#aglob').value};if(!body.path.trim()){toast('path required',true);return}}
if(a==='doctor-fix')body={action:'doctor',fix:true};
if(a==='purge'){if($('#pconfirm').value.trim()!=='purge'){toast('type "purge" in the box to confirm',true);return}body={action:'purge',scope:$('#pscope').value,confirm:true};$('#pconfirm').value=''}
const all=$$('[data-act]');all.forEach(b=>b.disabled=true);const label=btn.textContent;btn.innerHTML='<span class=spin></span> '+esc(label);alog(a+(body.scope?' '+body.scope:'')+(body.full?' --full':'')+(body.path?' '+body.path:'')+' …');
const r=await post('/api/actions',body);all.forEach(b=>b.disabled=false);btn.textContent=label;
if(r.error){alog(a+' failed: '+r.error,true);return}alog((r.ok?'✓ ':'✗ ')+a+' ('+r.ms+' ms)'+NL+r.output,!r.ok);if(r.ok)toast(a+' done');G.cache=null}
$$('[data-act]').forEach(b=>b.onclick=()=>act(b));

/* ---------- doctor ---------- */
async function doctor(fix){$('#dmeta').innerHTML='<span class=spin></span> running checks…';const d=await api('/api/doctor'+(fix?'?fix=1':''));if(d.error){$('#dmeta').innerHTML='<span class=bad>'+esc(d.error)+'</span>';return}const bad=d.filter(c=>!c.ok).length;$('#dmeta').innerHTML=bad?'<span class=bad>'+bad+' problem'+(bad>1?'s':'')+'</span>':'<span class=ok>all checks pass</span>';
$('#dtable').innerHTML=d.map(c=>'<tr><td class="'+(c.ok?'ok':'bad')+'" style="width:24px">'+(c.ok?'✓':'✗')+'</td><td style="white-space:nowrap">'+esc(c.name)+'</td><td>'+esc(c.detail)+'</td></tr>').join('')}
$('#drun').onclick=()=>doctor(false);$('#dfix').onclick=()=>doctor(true);

/* ---------- boot ---------- */
function load(tab){({overview,memories,graph:()=>{if(!G.nodes.length)graph()},search:()=>{},sessions,actions:()=>{},doctor:()=>doctor(false)})[tab]()}
projects().then(()=>{const t=location.hash.slice(1);showTab(t&&$('#'+t)?t:'overview')});
`;

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eminiar</title>
<style>${CSS}</style>
</head>
<body>
${HTML}
<script>${JS}</script>
</body>
</html>`;
