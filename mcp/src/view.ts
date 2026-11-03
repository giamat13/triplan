// MCP Apps view: one self-contained HTML page rendered by claude.ai in a sandboxed iframe.
// Every tool returns structuredContent of kind "page":
//   { kind:"page", title, sub?, chips?:[string], rows?:[[k,v]], sections?:[{heading, items:[Item], empty?}], bars?:[{label,text,value,max,over?}], note? }
//   Item = { icon?, time?, title, sub?, badge?, check?:boolean, call?:{name,arguments}, url? }
// A row with `call` is clickable: it runs that tool and shows its result (with a back button).
// Keep backticks and ${ out of the view code: it lives inside a String.raw template literal.
export const VIEW_URI = "ui://triplan/card.html";
export const VIEW_MIME = "text/html;profile=mcp-app";
export const VIEW_CSP = { resourceDomains: [] as string[] };

export const VIEW_HTML = /* html */ String.raw`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#1d2433;--mut:#667085;--line:#e4e7ec;--accent:#0e7490;--soft:#ecfeff;--bad:#b42318}
:root[data-theme=dark]{--bg:#161b22;--fg:#e8edf4;--mut:#9aa7b8;--line:#2d3644;--accent:#4fd1e6;--soft:#12303a;--bad:#f97066}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
.card{padding:14px 16px}h1{margin:0;font-size:18px;color:var(--accent)}h2{margin:14px 0 4px;font-size:13px;color:var(--mut);font-weight:600}
.sub{color:var(--mut);margin:2px 0 8px}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{background:var(--soft);color:var(--accent);border-radius:999px;padding:2px 10px;font-size:12px}
.row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)}
.row.go{cursor:pointer}.row.go:hover{background:var(--soft)}
.ic{width:22px;text-align:center;flex:none}.tm{color:var(--mut);min-width:44px;flex:none;direction:ltr;text-align:left}
.tx{flex:1;min-width:0}.t{font-weight:600;overflow-wrap:anywhere}.s{color:var(--mut);font-size:13px;overflow-wrap:anywhere}
.badge{flex:none;font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.done .t{text-decoration:line-through;color:var(--mut)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0}dt{color:var(--mut)}dd{margin:0;overflow-wrap:anywhere}
.bar{margin:8px 0}.bar .l{display:flex;justify-content:space-between;font-size:13px}.bar .track{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:3px}
.bar .fill{height:100%;background:var(--accent)}.bar.over .fill{background:var(--bad)}
a{color:var(--accent)}.note{color:var(--mut);font-size:12px;margin-top:12px}.err{color:var(--bad)}
button.back{background:none;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:2px 10px;cursor:pointer;margin-bottom:8px}
</style></head><body><div id="root"></div><script>
(function(){
var root=document.getElementById("root"),nextId=2,pending={},stack=[],cur=null;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function add(p,c){if(c)p.appendChild(c);return p}
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function request(method,params){return new Promise(function(res,rej){var id=nextId++;pending[id]={res:res,rej:rej};send({id:id,method:method,params:params})})}
function size(){send({method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})}
function theme(ctx){if(ctx&&ctx.theme)document.documentElement.setAttribute("data-theme",ctx.theme)}
function textOf(r){return(r&&r.content||[]).map(function(c){return c.text||""}).join("\n")}
function item(it){var r=el("div","row"+(it.call?" go":"")+(it.check?" done":""));
 if(it.check!==undefined&&it.check!==null){add(r,el("div","ic",it.check?"☑":"☐"))}else if(it.icon){add(r,el("div","ic",it.icon))}
 if(it.time)add(r,el("div","tm",it.time));
 var tx=el("div","tx"),t=el("div","t");
 if(it.url){var a=el("a",null,it.title);a.href=it.url;a.target="_blank";a.rel="noopener noreferrer";add(t,a)}else t.textContent=it.title||"";
 add(tx,t);if(it.sub)add(tx,el("div","s",it.sub));add(r,tx);
 if(it.badge)add(r,el("div","badge",it.badge));
 if(it.call)r.addEventListener("click",function(){go(it.call)});return r}
function page(d){var c=el("div","card");
 if(stack.length){var b=el("button","back","→ חזרה");b.addEventListener("click",function(){cur=stack.pop();render(cur)});add(c,b)}
 add(c,el("h1",null,d.title||""));if(d.sub)add(c,el("div","sub",d.sub));
 if(d.chips&&d.chips.length){var ch=el("div","chips");d.chips.forEach(function(x){add(ch,el("span","chip",x))});add(c,ch)}
 if(d.rows&&d.rows.length){var dl=el("dl");d.rows.forEach(function(r){if(r[1]==null||r[1]==="")return;add(dl,el("dt",null,r[0]));add(dl,el("dd",null,String(r[1])))});add(c,dl)}
 (d.bars||[]).forEach(function(b){var w=el("div","bar"+(b.over?" over":""));var l=el("div","l");add(l,el("span",null,b.label));add(l,el("span",null,b.text||""));add(w,l);
  var tr=el("div","track"),f=el("div","fill");f.style.width=Math.max(0,Math.min(100,b.max?b.value/b.max*100:0))+"%";add(tr,f);add(w,tr);add(c,w)});
 (d.sections||[]).forEach(function(sec){if(sec.heading)add(c,el("h2",null,sec.heading));(sec.items||[]).forEach(function(it){add(c,item(it))});
  if(!(sec.items||[]).length&&sec.empty)add(c,el("div","s",sec.empty))});
 if(d.note)add(c,el("div","note",d.note));return c}
function render(d){root.textContent="";if(d&&d.kind==="page")add(root,page(d));else add(root,add(el("div","card"),el("div",d&&d.error?"err":null,(d&&d.text)||"אין נתונים להצגה.")));size()}
function show(d){if(cur)stack.push(cur);cur=d;render(d)}
function go(call){request("tools/call",call).then(function(r){var d=r&&r.structuredContent;
  if(r&&r.isError)d={kind:"text",error:1,text:textOf(r)};
  d=d||{kind:"text",text:textOf(r)||"אין תוצאה."};
  var isRead=call.name.indexOf("get_")===0||call.name.indexOf("list_")===0;
  if(isRead||!cur)show(d);else{cur=d;render(d)}},
  function(e){show({kind:"text",error:1,text:"הטעינה נכשלה: "+(e&&e.message||"שגיאה")})})}
window.addEventListener("message",function(e){var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!=null&&pending[m.id]&&(m.result!==undefined||m.error)){var p=pending[m.id];delete pending[m.id];if(m.error)p.rej(m.error);else p.res(m.result);return}
 if(m.method==="ui/notifications/tool-result"){var r=m.params||{};stack=[];cur=r.structuredContent||{kind:"text",text:textOf(r)};render(cur)}
 else if(m.method==="ui/notifications/host-context-changed"){theme(m.params)}
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}})}
});
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
request("ui/initialize",{appInfo:{name:"triplan-card",version:"1.0.0"},appCapabilities:{},protocolVersion:"2026-01-26"}).then(function(r){if(r)theme(r.hostContext);send({method:"ui/notifications/initialized",params:{}});size()},function(){});
})();
</script></body></html>`;
