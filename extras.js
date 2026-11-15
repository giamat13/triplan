/* triplan v2 extras: accessibility, home screen, dashboard, group hub (chat, polls,
   shared expenses, tasks, shared packing, presence, live location), idea votes,
   done marks, day actions, tools, search, calendar export, private notes.
   Everything shared lives in NEW subcollections of trips/{id} - the trip document
   itself is never reshaped, so existing data stays exactly as it was. */
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, addDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const TP = window.TP;
if(TP) init(); else console.error('extras.js: core app did not load');

function init(){
const $ = id => document.getElementById(id);
const esc = s => TP.escapeAttr(s).replace(/>/g, '&gt;');
const toast = m => TP.showToast(m);
const me = () => TP.user?.uid || '';
const nameOf = uid => TP.resolveMemberName(uid) || 'משתתף';
const memberUids = () => Object.keys(TP.members || {});
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v === null ? d : v; }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const ago = ts => ts ? TP.timeAgoLabel(ts) : '';
const money = (n, cur) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL') + TP.currencySymbolFor(cur || TP.state.currency);
const col = name => collection(TP.db, 'trips', TP.tripId, name);
const ref = (name, id) => doc(TP.db, 'trips', TP.tripId, name, id);
const safe = p => Promise.resolve(p).catch(err => { console.warn('[extras]', err); toast('הפעולה לא הצליחה. בדקו את החיבור לאינטרנט ונסו שוב.'); });
const linkify = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">קישור 🔗</a>');
const actTitleList = day => day.activities.filter(a => (a.title || '').trim());

/* ================= accessibility settings ================= */
const A11Y_KEY = 'triplan-a11y-v1';
let a11y = { theme:'auto', fs:1, motion:'on', simple:false };
try{ Object.assign(a11y, JSON.parse(localStorage.getItem(A11Y_KEY) || '{}')); }catch(e){}
function applyA11y(){
  const root = document.documentElement;
  const theme = a11y.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : a11y.theme;
  root.dataset.theme = theme;
  root.dataset.fs = String(a11y.fs);
  root.dataset.motion = a11y.motion === 'off' ? 'off' : 'on';
  document.body.classList.toggle('simple', !!a11y.simple);
  lsSet(A11Y_KEY, JSON.stringify(a11y));
}
applyA11y();

/* ================= sheets (big, simple dialogs) ================= */
function sheet(title, html, onOpen){
  const root = $('sheetRoot');
  root.innerHTML = `<div class="sheet-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="btn btn-ghost" type="button" data-close>✕ סגור</button></div>
    <div class="sheet-body">${html}</div></div></div>`;
  const overlay = root.firstElementChild;
  const close = () => { root.innerHTML = ''; speechSynthesis?.cancel?.(); };
  overlay.addEventListener('click', e => { if(e.target === overlay || e.target.closest('[data-close]')) close(); });
  if(onOpen) onOpen(overlay.querySelector('.sheet-body'), close);
  overlay.querySelector('[data-close]').focus();
  return close;
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') $('sheetRoot').innerHTML = ''; });

async function share(text, title){
  if(navigator.share){ try{ await navigator.share({ title: title || 'triplan', text }); return; }catch(e){ if(e.name === 'AbortError') return; } }
  sheet('שליחה', `<textarea class="share-text" rows="9" style="width:100%" readonly>${esc(text)}</textarea>
    <div class="sheet-actions"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">שלח בוואטסאפ</a>
    <button class="btn btn-ghost" type="button" data-copy>📋 העתק</button></div>`, body => {
    body.querySelector('[data-copy]').addEventListener('click', () => copyText(text));
  });
}
function copyText(t){ navigator.clipboard?.writeText(t).then(() => toast('הועתק ✔'), () => toast('לא הצלחתי להעתיק')); }

/* voice typing on any input */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function micButton(input){
  if(!SR) return '';
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-ghost'; b.textContent = '🎤'; b.title = 'הקלדה בקול'; b.setAttribute('aria-label', 'הקלדה בקול');
  b.addEventListener('click', () => {
    const r = new SR(); r.lang = 'he-IL'; r.interimResults = false;
    b.textContent = '🔴';
    r.onresult = ev => { input.value = (input.value ? input.value + ' ' : '') + ev.results[0][0].transcript; input.dispatchEvent(new Event('input', { bubbles:true })); };
    r.onend = () => { b.textContent = '🎤'; };
    r.onerror = () => { b.textContent = '🎤'; toast('לא הצלחתי לשמוע. נסו שוב.'); };
    r.start();
  });
  return b;
}

function openSettings(){
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(a11y[key]) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  sheet('תצוגה ונגישות', `
    <div class="opt-row"><b>גודל הכתב</b>${seg('fs', [[0,'רגיל'],[1,'גדול'],[2,'גדול מאוד'],[3,'ענק']])}</div>
    <div class="opt-row"><b>צבעים</b>${seg('theme', [['auto','אוטומטי'],['light','בהיר'],['dark','כהה'],['hc','ניגודיות גבוהה']])}</div>
    <label class="switch-row"><input type="checkbox" data-sw="simple" ${a11y.simple ? 'checked' : ''}> <span><b>מצב פשוט</b><br><small>מסתיר אפשרויות מתקדמות ומשאיר רק את מה שחשוב</small></span></label>
    <label class="switch-row"><input type="checkbox" data-sw="motion" ${a11y.motion === 'off' ? 'checked' : ''}> <span><b>בלי אנימציות</b><br><small>מסך רגוע בלי תנועה</small></span></label>
    <div class="opt-row"><b>השם שלי (כך אחרים רואים אותי)</b>
      <div class="field-row"><input id="xName" value="${esc(TP.myName || '')}" placeholder="השם שלכם"><button class="btn btn-primary" type="button" id="xNameSave">שמור</button></div></div>
    <div class="opt-row"><b>הסמל שלי</b><div class="emoji-pick" id="xAvatar">${['🙂','😎','🤠','🧳','🌴','🦊','🐼','🦁','🌸','⭐','🚀','🍕'].map(e => `<button type="button" data-e="${e}" class="${S.profiles[me()]?.avatar === e ? 'active' : ''}">${e}</button>`).join('')}</div></div>
  `, body => {
    body.addEventListener('click', e => {
      const b = e.target.closest('.seg button');
      if(b){ const key = b.parentElement.dataset.key; a11y[key] = key === 'fs' ? Number(b.dataset.v) : b.dataset.v; applyA11y();
        b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }
      const em = e.target.closest('#xAvatar button');
      if(em && me()){
        S.profiles[me()] = { ...(S.profiles[me()] || {}), avatar: em.dataset.e };
        safe(setDoc(doc(TP.db, 'users', me()), { avatar: em.dataset.e }, { merge:true }));
        em.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === em));
        refreshAll();
      }
    });
    body.addEventListener('change', e => {
      const sw = e.target.dataset.sw;
      if(sw === 'simple'){ a11y.simple = e.target.checked; applyA11y(); }
      if(sw === 'motion'){ a11y.motion = e.target.checked ? 'off' : 'on'; applyA11y(); }
    });
    body.querySelector('#xNameSave').addEventListener('click', async () => {
      const v = body.querySelector('#xName').value.trim();
      if(!v) return;
      await safe(TP.setMyName(v)); toast('השם נשמר ✔'); refreshAll();
    });
  });
}

function openHelp(){
  const steps = [
    ['🏡','ראשי','מראה מה קורה עכשיו: כמה ימים נשארו, מה הפעילות הבאה ומה עוד צריך להכין.'],
    ['📅','לוח זמנים','כל יום בטיול. לוחצים "הוסף פעילות", כותבים מה עושים ובאיזו שעה. כשמסיימים פעילות לוחצים על ה-✓ העגול.'],
    ['💡','רעיונות','מקומות שאולי נרצה לבקר בהם. כל אחד יכול לתת 👍 לרעיון שהוא אוהב.'],
    ['👥','קבוצה','מדברים עם שאר המשתתפים, מצביעים, מחלקים הוצאות ומשימות, ומזמינים אנשים חדשים.'],
    ['☰','עוד','תקציב, רשימת אריזה, כלים לדרך, הדפסה והגדרות.'],
    ['🔠','תצוגה','למעלה במסך: מגדילים את הכתב, מחליפים צבעים או עוברים ל"מצב פשוט".'],
    ['💾','שמירה','לא צריך ללחוץ "שמור". כל שינוי נשמר לבד ומופיע אצל כל המשתתפים.']
  ];
  sheet('איך משתמשים?', steps.map(([e, t, d]) => `<div class="help-step"><span class="em">${e}</span><div><b>${t}</b><br>${d}</div></div>`).join(''));
}

/* ================= live data of the active trip ================= */
const S = { messages:[], polls:[], expenses:[], tasks:[], shared:[], votes:{}, done:{}, presence:{}, locations:{}, feed:[], profiles:{}, ready:{} };
let unsubs = [];
let presenceTimer = null;
let geoWatch = null;

function subscribe(){
  unsubs.forEach(u => { try{ u(); }catch(e){} });
  unsubs = [];
  Object.assign(S, { messages:[], polls:[], expenses:[], tasks:[], shared:[], votes:{}, done:{}, presence:{}, locations:{}, feed:[], ready:{} });
  stopLocation(true);
  if(!TP.tripId || !TP.user) return;
  const listen = (name, q, fn) => { try{ unsubs.push(onSnapshot(q, fn, err => console.warn('[extras] ' + name, err.code || err))); }catch(e){ console.warn(e); } };
  const list = snap => snap.docs.map(d => ({ id:d.id, ...d.data() }));
  const byUid = snap => { const o = {}; snap.docs.forEach(d => { o[d.id] = d.data(); }); return o; };

  listen('messages', query(col('messages'), orderBy('ts', 'desc'), limit(200)), snap => {
    const first = !S.ready.messages; S.ready.messages = true;
    const before = new Set(S.messages.map(m => m.id));
    S.messages = list(snap).reverse();
    if(!first){
      const fresh = S.messages.filter(m => !before.has(m.id) && m.by !== me());
      if(fresh.length && !chatVisible()) toast('💬 ' + nameOf(fresh[fresh.length - 1].by) + ': ' + String(fresh[fresh.length - 1].text || '').slice(0, 60));
    }
    segUpdate('chat'); updateBadge(); renderDashboard();
  });
  listen('polls', query(col('polls'), orderBy('ts', 'desc'), limit(50)), snap => { S.polls = list(snap); segUpdate('polls'); renderDashboard(); });
  listen('expenses', query(col('expenses'), orderBy('ts', 'desc'), limit(300)), snap => { S.expenses = list(snap); segUpdate('money'); renderDashboard(); });
  listen('tasks', query(col('tasks'), orderBy('ts', 'desc'), limit(200)), snap => { S.tasks = list(snap); segUpdate('tasks'); renderDashboard(); });
  listen('sharedPacking', query(col('sharedPacking'), orderBy('ts', 'asc'), limit(300)), snap => { S.shared = list(snap); segUpdate('bring'); });
  listen('ideaVotes', col('ideaVotes'), snap => { const o = byUid(snap); S.votes = {}; Object.keys(o).forEach(u => { S.votes[u] = o[u].votes || {}; }); decorateIdeas(); });
  listen('marks', ref('marks', 'done'), snap => { S.done = (snap.exists() && snap.data().done) || {}; paintDone(); renderDashboard(); });
  listen('presence', col('presence'), snap => { S.presence = byUid(snap); segUpdate('people'); renderDashboard(); });
  listen('locations', col('locations'), snap => { S.locations = byUid(snap); segUpdate('people'); });
  listen('activityLog', query(col('activityLog'), orderBy('createdAt', 'desc'), limit(30)), snap => { S.feed = list(snap); segUpdate('feed'); renderDashboard(); });

  clearInterval(presenceTimer);
  const beat = () => { if(TP.tripId && me() && document.visibilityState === 'visible') setDoc(ref('presence', me()), { ts: Date.now() }).catch(() => {}); };
  beat(); presenceTimer = setInterval(beat, 60000);
  loadProfiles();
}
async function loadProfiles(){
  await Promise.all(memberUids().map(async uid => {
    if(S.profiles[uid]) return;
    try{ const s = await getDoc(doc(TP.db, 'users', uid)); S.profiles[uid] = s.exists() ? s.data() : {}; }catch(e){ S.profiles[uid] = {}; }
  }));
  refreshAll();
}
const isOnline = uid => uid === me() || (S.presence[uid]?.ts || 0) > Date.now() - 150000;
function avatar(uid, cls){
  const p = S.profiles[uid] || {};
  const label = p.avatar || (nameOf(uid).trim()[0] || '?');
  return `<span class="avatar ${cls || ''} ${isOnline(uid) ? 'online' : ''}" title="${esc(nameOf(uid))}">${esc(label)}</span>`;
}

/* ================= home screen ================= */
const SCREEN_KEY = 'triplan-screen-v1';
function setScreen(s){
  document.body.dataset.screen = s;
  lsSet(SCREEN_KEY, s);
  if(s === 'home') renderHome();
  updateTitle();
  window.scrollTo(0, 0);
}
function updateTitle(){
  $('appbarTitle').textContent = document.body.dataset.screen === 'home' ? 'מתכנן טיולים' : (TP.state.name || 'טיול ללא שם');
}
const TRIP_EMOJI = ['🌍','🏝️','🏔️','🏙️','🚗','⛱️','🗺️','🚆','🏕️','✈️'];
const emojiFor = id => TRIP_EMOJI[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TRIP_EMOJI.length];
function renderHome(){
  const box = $('tripCards');
  if(!box) return;
  $('homeGreeting').textContent = TP.myName ? `שלום ${TP.myName}! לאן נוסעים?` : 'שלום! לאן נוסעים?';
  const trips = (TP.trips || []).filter(t => TP.showArchived || !t.archived);
  if(!trips.length){ box.innerHTML = '<div class="empty">עוד אין טיולים. לחצו על "טיול חדש" כדי להתחיל.</div>'; return; }
  const roleLabel = { owner:'מנהל/ת', editor:'עורך/ת', viewer:'צופה' };
  box.innerHTML = trips.map(t => {
    let meta = [];
    if(t.startDate){
      const d = new Date(t.startDate + 'T00:00:00');
      if(!isNaN(d)){
        meta.push(d.toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' }));
        const diff = Math.round((d - new Date().setHours(0, 0, 0, 0)) / 864e5);
        if(diff > 0) meta.push(`עוד ${diff} ימים`); else if(diff === 0) meta.push('מתחיל היום!');
      }
    }
    if(t.daysCount) meta.push(t.daysCount + ' ימים');
    meta.push(roleLabel[t.role] || '');
    if(t.archived) meta.push('📦 בארכיון');
    return `<button type="button" class="trip-card ${t.id === TP.tripId ? 'current' : ''}" data-id="${esc(t.id)}">
      <span class="trip-card-emoji">${emojiFor(t.id)}</span>
      <span class="trip-card-body"><span class="trip-card-name">${esc(t.id === TP.tripId ? (TP.state.name || t.name) : t.name || 'טיול ללא שם')}</span>
      <span class="trip-card-meta">${esc(meta.filter(Boolean).join(' · '))}</span></span>
      <span class="trip-card-go" aria-hidden="true">‹</span></button>`;
  }).join('');
}
$('tripCards').addEventListener('click', async e => {
  const c = e.target.closest('.trip-card'); if(!c) return;
  if(c.dataset.id !== TP.tripId){ c.classList.add('current'); await safe(TP.switchToTrip(c.dataset.id)); }
  setScreen('trip'); TP.setActiveTab('overview');
});
$('homeBtn').addEventListener('click', () => setScreen('home'));
$('settingsBtn').addEventListener('click', openSettings);
$('helpBtn').addEventListener('click', openHelp);
$('searchBtn').addEventListener('click', openSearch);
$('joinOpenBtn').addEventListener('click', () => { const c = $('joinCard'); c.hidden = !c.hidden; if(!c.hidden) $('joinCodeInput').focus(); });
$('newTripWizardBtn').addEventListener('click', () => {
  sheet('טיול חדש', `
    <label class="field"><span>איך נקרא לטיול?</span><input id="wName" placeholder="למשל: רומא עם המשפחה"></label>
    <label class="field"><span>מתי מתחילים? (אפשר להשאיר ריק)</span><input id="wDate" type="date"></label>
    <label class="field"><span>כמה ימים?</span><input id="wDays" type="number" min="1" max="60" value="3" inputmode="numeric"></label>
    <div class="sheet-actions"><button class="btn btn-primary btn-block" type="button" id="wGo">✔ צור את הטיול</button></div>`, (body, close) => {
    body.querySelector('#wGo').addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'יוצר…';
      try{
        const n = Math.max(1, Math.min(60, Number(body.querySelector('#wDays').value) || 1));
        const id = await TP.createTrip({ name: body.querySelector('#wName').value.trim(), startDate: body.querySelector('#wDate').value }, 'הטיול שלי');
        await TP.switchToTrip(id);
        for(let i = TP.state.days.length; i < n; i++) $('addDay').click();
        TP.goToDay(0);
        close(); setScreen('trip'); TP.setActiveTab('days'); toast('הטיול נוצר 🎉');
      }catch(err){ console.error(err); toast('לא הצלחתי ליצור טיול. נסו שוב.'); e.target.disabled = false; e.target.textContent = '✔ צור את הטיול'; }
    });
  });
});
$('dupTripBtn')?.addEventListener('click', async () => {
  if(!confirm('ליצור העתק חדש של הטיול הזה? ההעתק יהיה שלכם בלבד, והטיול המקורי לא ישתנה.')) return;
  try{
    const data = JSON.parse(JSON.stringify(TP.state));
    data.name = (data.name || 'טיול') + ' (העתק)';
    const id = await TP.createTrip(data);
    await TP.switchToTrip(id);
    TP.setActiveTab('overview'); toast('נוצר העתק של הטיול ✔');
  }catch(err){ console.error(err); toast('השכפול לא הצליח.'); }
});

/* sync indicator */
let syncErr = false;
function paintSync(){
  const dot = $('syncDot'); const off = !navigator.onLine;
  dot.classList.toggle('off', off); dot.classList.toggle('err', syncErr && !off);
  const label = off ? 'אין אינטרנט - יישמר כשהחיבור יחזור' : syncErr ? 'השמירה נכשלה' : 'מחובר - הכל נשמר';
  dot.title = label; dot.setAttribute('aria-label', label);
  $('offlineBanner').hidden = !off;
}
addEventListener('online', paintSync); addEventListener('offline', paintSync); paintSync();

/* ================= done marks + day progress ================= */
function setDone(id, v){
  if(v) S.done[id] = true; else delete S.done[id];
  paintDone(); renderDashboard();
  if(TP.tripId) safe(setDoc(ref('marks', 'done'), { done: { [id]: v ? true : deleteField() } }, { merge:true }));
}
function paintDone(){
  document.querySelectorAll('#days .activity[data-act-id]').forEach(row => {
    const on = !!S.done[row.dataset.actId];
    row.classList.toggle('is-done', on);
    row.querySelector('[data-role="done"]')?.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('#days .day-card').forEach(card => {
    const day = TP.state.days[Number(card.dataset.dayIndex)];
    const el = card.querySelector('[data-role="day-progress"]');
    if(!day || !el) return;
    const acts = actTitleList(day); const d = acts.filter(a => S.done[a.id]).length;
    el.innerHTML = acts.length ? `<div class="meter ${d === acts.length ? 'ok' : ''}"><i style="width:${Math.round(d / acts.length * 100)}%"></i></div><small>${d === acts.length ? '🎉 סיימתם את כל היום!' : `בוצעו ${d} מתוך ${acts.length}`}</small>` : '';
  });
}

/* ================= day actions ================= */
function dayText(i){
  const day = TP.state.days[i]; if(!day) return '';
  const head = `יום ${i + 1}` + (TP.formatDate(TP.state.startDate, i) ? ` · ${TP.formatDate(TP.state.startDate, i)}` : '') + (day.destination ? ` · ${day.destination}` : '');
  const lines = actTitleList(day).map(a => `${a.time ? a.time + ' ' : '• '}${a.title}${a.notes ? ' (' + a.notes + ')' : ''}`);
  if(day.hotel?.name) lines.push('🛏 לינה: ' + day.hotel.name);
  return [head, ...lines].join('\n');
}
function dayAction(x, i){
  const day = TP.state.days[i]; if(!day) return;
  if(x === 'read-day'){
    if(!window.speechSynthesis) return toast('הקראה לא נתמכת במכשיר הזה');
    if(speechSynthesis.speaking){ speechSynthesis.cancel(); return; }
    const acts = actTitleList(day);
    const txt = `יום ${i + 1}${day.destination ? ', ' + day.destination : ''}. ` + (acts.length ? acts.map(a => (a.time ? `בשעה ${a.time}, ` : '') + a.title).join('. ') : 'עדיין אין פעילויות ביום הזה.') + (day.hotel?.name ? `. לינה ב${day.hotel.name}.` : '');
    const u = new SpeechSynthesisUtterance(txt); u.lang = 'he-IL'; u.rate = 0.9;
    speechSynthesis.speak(u); toast('🔊 מקריא… לחצו שוב כדי לעצור');
  } else if(x === 'share-day'){
    share(dayText(i), TP.state.name);
  } else if(x === 'nav-day'){
    const stops = actTitleList(day).filter(a => a.category !== 'transport').map(a => (a.title + ' ' + (day.destination || '')).trim());
    if(!stops.length && !day.destination) return toast('אין עדיין מקומות ביום הזה');
    const dest = stops.length ? stops[stops.length - 1] : day.destination;
    const way = stops.slice(0, -1).slice(0, 8);
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) + (way.length ? '&waypoints=' + encodeURIComponent(way.join('|')) : ''), '_blank', 'noopener');
  }
}
function pickDay(title, cb){
  sheet(title, `<div class="tile-grid">${TP.state.days.map((d, i) => `<button class="tile" type="button" data-i="${i}"><span class="em">${i + 1}</span>${esc(TP.formatDate(TP.state.startDate, i) || 'יום ' + (i + 1))}<small>${esc(d.destination || '')}</small></button>`).join('')}</div>`, (body, close) => {
    body.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if(b){ close(); cb(Number(b.dataset.i)); } });
  });
}

/* ================= idea votes ================= */
const voteCount = id => Object.values(S.votes).filter(v => v && v[id]).length;
function decorateIdeas(){
  document.querySelectorAll('#attractionsBody .idea-card[data-idea-id]').forEach(card => {
    const id = card.dataset.ideaId;
    let b = card.querySelector(':scope > .idea-vote-row > .idea-vote');
    if(!b){
      const row = document.createElement('div'); row.className = 'idea-vote-row no-print';
      b = document.createElement('button'); b.type = 'button'; b.className = 'idea-vote'; b.setAttribute('data-viewer-ok', '');
      b.addEventListener('click', e => {
        e.stopPropagation();
        const mine = S.votes[me()] || (S.votes[me()] = {});
        const on = !mine[id];
        if(on) mine[id] = true; else delete mine[id];
        decorateIdeas();
        safe(setDoc(ref('ideaVotes', me()), { votes: { [id]: on ? true : deleteField() } }, { merge:true }));
      });
      row.appendChild(b); card.appendChild(row);
    }
    b.style.display = '';
    const n = voteCount(id); const on = !!(S.votes[me()] || {})[id];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    b.textContent = `👍 ${on ? 'אהבתי' : 'אני בעד'}${n ? ' · ' + n : ''}`;
    b.title = Object.keys(S.votes).filter(u => S.votes[u][id]).map(nameOf).join(', ');
  });
}

/* ================= dashboard ================= */
function tripPhase(){
  const s = TP.state; if(!s.startDate) return { k:'nodate' };
  const start = new Date(s.startDate + 'T00:00:00'); if(isNaN(start)) return { k:'nodate' };
  const diff = Math.round((start - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if(diff > 0) return { k:'before', days:diff };
  if(diff > -s.days.length) return { k:'during', idx:-diff };
  return { k:'after' };
}
function allActs(){ return TP.state.days.flatMap(actTitleList); }
function renderDashboard(){
  const el = $('dashboard'); if(!el || !TP.state) return;
  const s = TP.state; const ph = tripPhase();
  let hero = '', next = '';
  if(ph.k === 'nodate') hero = `<div class="dash-hero"><div>📅 עוד לא נקבע תאריך לטיול</div><button class="btn btn-primary" type="button" data-a="set-date">קבעו תאריך</button></div>`;
  else if(ph.k === 'before') hero = `<div class="dash-hero"><div class="big">${ph.days}</div><div>${ph.days === 1 ? 'יום אחד עד הטיול! 🎉' : 'ימים עד הטיול'}</div></div>`;
  else if(ph.k === 'after') hero = `<div class="dash-hero"><div class="big">🏁</div><div>הטיול הסתיים. מקווים שנהניתם!</div></div>`;
  else {
    const day = s.days[ph.idx];
    hero = `<div class="dash-hero"><div>היום</div><div class="big">יום ${ph.idx + 1} מתוך ${s.days.length}</div><div>${esc(day.destination || '')}</div></div>`;
    const now = new Date().toTimeString().slice(0, 5);
    const timed = actTitleList(day).filter(a => a.time).sort((a, b) => a.time.localeCompare(b.time));
    const cur = timed.filter(a => a.time <= now && !S.done[a.id]).pop();
    const nx = timed.find(a => a.time > now && !S.done[a.id]);
    next = `<div class="card"><div class="card-title">מה עכשיו?</div>
      ${cur ? `<div class="next-act"><span class="t">${esc(cur.time)}</span><span>עכשיו: <b>${esc(cur.title)}</b></span><button class="btn btn-sm btn-primary" type="button" data-a="done" data-id="${esc(cur.id)}">✓ סיימנו</button></div>` : ''}
      ${nx ? `<div class="next-act"><span class="t">${esc(nx.time)}</span><span>הבא בתור: <b>${esc(nx.title)}</b></span></div>` : ''}
      ${!cur && !nx ? '<div class="empty">אין עוד פעילויות עם שעה להיום.</div>' : ''}
      <button class="btn btn-primary btn-block" type="button" data-a="today" data-i="${ph.idx}">📅 לתוכנית של היום</button></div>`;
  }
  const acts = allActs(); const doneN = acts.filter(a => S.done[a.id]).length;
  const pk = TP.packing || []; const pkDone = pk.filter(p => p.checked).length;
  const needBook = acts.filter(a => a.booking); const booked = needBook.filter(a => a.confirmation).length;
  const spent = TP.totalPlanned() || 0; const cap = Number(s.budget) || 0;
  const openTasks = S.tasks.filter(t => !t.done); const myTasks = openTasks.filter(t => t.to === me());
  const openPolls = S.polls.filter(p => !p.closed && p.votes?.[me()] === undefined);
  const meter = (label, a, b, go) => `<button type="button" class="kv" data-a="go" data-tab="${go}"><span>${label}</span><b>${a}/${b}</b><div class="meter ${b && a >= b ? 'ok' : ''}"><i style="width:${b ? Math.min(100, Math.round(a / b * 100)) : 0}%"></i></div></button>`;
  const unread = unreadCount();
  el.innerHTML = `${hero}${next}
    <div class="card"><div class="card-title">מה צריך את תשומת הלב</div><div class="chips">
      ${unread ? `<button class="chip warn" type="button" data-a="grp" data-seg="chat">💬 ${unread} הודעות חדשות</button>` : ''}
      ${openPolls.length ? `<button class="chip warn" type="button" data-a="grp" data-seg="polls">🗳️ ${openPolls.length} הצבעות מחכות לך</button>` : ''}
      ${myTasks.length ? `<button class="chip warn" type="button" data-a="grp" data-seg="tasks">✅ ${myTasks.length} משימות שלך</button>` : ''}
      ${needBook.length - booked ? `<button class="chip danger" type="button" data-a="go" data-tab="days">⚠️ ${needBook.length - booked} הזמנות שעוד לא נסגרו</button>` : ''}
      ${cap && spent > cap ? `<button class="chip danger" type="button" data-a="go" data-tab="budget">💸 חריגה מהתקציב</button>` : ''}
      ${!unread && !openPolls.length && !myTasks.length && !(needBook.length - booked) && !(cap && spent > cap) ? '<span class="chip ok">👍 הכל מסודר</span>' : ''}
    </div></div>
    <div class="card"><div class="card-title">עד כמה אנחנו מוכנים</div><div class="dash-grid">
      ${meter('🎒 אריזה', pkDone, pk.length, 'packing')}
      ${meter('🎟️ הזמנות', booked, needBook.length, 'days')}
      ${meter('✓ פעילויות שבוצעו', doneN, acts.length, 'days')}
      ${cap ? `<button type="button" class="kv" data-a="go" data-tab="budget"><span>💰 תקציב</span><b>${money(spent)} / ${money(cap)}</b><div class="meter ${spent > cap ? 'danger' : spent > cap * .85 ? 'warn' : 'ok'}"><i style="width:${Math.min(100, Math.round(spent / cap * 100))}%"></i></div></button>` : `<button type="button" class="kv" data-a="go" data-tab="budget"><span>💰 עלות מתוכננת</span><b>${money(spent)}</b></button>`}
    </div></div>
    <div class="card"><div class="card-title">פעולות מהירות</div><div class="tile-grid">
      <button class="tile" type="button" data-a="go" data-tab="days"><span class="em">📅</span>לוח הזמנים</button>
      <button class="tile" type="button" data-a="grp" data-seg="chat"><span class="em">💬</span>שיחת הקבוצה</button>
      <button class="tile" type="button" data-a="grp" data-seg="money"><span class="em">💸</span>הוצאות משותפות</button>
      <button class="tile" type="button" data-a="grp" data-seg="people"><span class="em">➕</span>הזמן אנשים</button>
    </div></div>
    <div class="card"><div class="card-title">מי בטיול (${memberUids().length})</div><div class="avatar-stack">${memberUids().map(u => avatar(u)).join('')}</div>
      ${S.feed.length ? `<div class="feed-mini">${S.feed.slice(0, 3).map(f => `<div class="feed-item">${avatar(f.by, 'sm')}<span>${esc(f.text || '')}</span><small>${ago(f.createdAt?.toMillis?.())}</small></div>`).join('')}</div>` : ''}</div>`;
}
$('dashboard').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if(!b) return;
  const a = b.dataset.a;
  if(a === 'go') TP.setActiveTab(b.dataset.tab);
  else if(a === 'grp') openGroup(b.dataset.seg);
  else if(a === 'today'){ TP.setActiveTab('days'); TP.goToDay(Number(b.dataset.i)); }
  else if(a === 'done') setDone(b.dataset.id, true);
  else if(a === 'set-date'){ $('tripDetailsFold').open = true; $('startDate').focus(); $('startDate').scrollIntoView({ block:'center' }); }
});

/* ================= group hub ================= */
const SEGS = [['chat','💬 שיחה'],['polls','🗳️ הצבעות'],['money','💸 הוצאות'],['tasks','✅ משימות'],['bring','🎒 מי מביא'],['people','👥 משתתפים'],['feed','🕘 מה חדש']];
let seg = lsGet('triplan-grp-seg', 'chat');
if(!SEGS.some(s => s[0] === seg)) seg = 'chat';
const groupVisible = () => document.body.dataset.screen === 'trip' && $('panelGroup').classList.contains('active');
const chatVisible = () => groupVisible() && seg === 'chat' && document.visibilityState === 'visible';
function openGroup(s){ if(s){ seg = s; lsSet('triplan-grp-seg', s); } TP.setActiveTab('group'); }
function renderGroup(){
  $('grpSeg').innerHTML = SEGS.map(([k, l]) => `<button type="button" role="tab" data-seg="${k}" class="${k === seg ? 'active' : ''}" aria-selected="${k === seg}">${l}</button>`).join('');
  $('grpMembersStatic').hidden = seg !== 'people';
  const el = $('grpDyn'); el.innerHTML = '';
  BUILD[seg](el); segUpdate(seg);
  if(seg === 'chat') markSeen();
}
$('grpSeg').addEventListener('click', e => { const b = e.target.closest('[data-seg]'); if(b){ seg = b.dataset.seg; lsSet('triplan-grp-seg', seg); renderGroup(); } });
function segUpdate(k){ if(k === seg && groupVisible() && UPDATE[k]) UPDATE[k](); }
const memberOptions = sel => memberUids().map(u => `<option value="${esc(u)}" ${u === sel ? 'selected' : ''}>${esc(nameOf(u))}</option>`).join('');
const canDelete = item => item.by === me() || TP.role === 'owner';

/* unread chat */
const seenKey = () => 'triplan-chat-seen-' + TP.tripId;
const unreadCount = () => { const seen = Number(lsGet(seenKey(), 0)); return S.messages.filter(m => m.by !== me() && (m.ts || 0) > seen).length; };
function markSeen(){ lsSet(seenKey(), Date.now()); updateBadge(); }
function updateBadge(){
  if(chatVisible()){ lsSet(seenKey(), Date.now()); }
  const n = unreadCount(); const b = $('groupBadge');
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n);
}

const BUILD = {
  chat(el){
    el.innerHTML = `<div class="card"><div class="chat-list" id="xChat" aria-live="polite"></div>
      <div class="quick-replies">${['👍 מסכים','אני מגיע/ה!','מאחר/ת קצת','איפה אתם?','תודה! 🙏'].map(t => `<button type="button" class="chip" data-q="${esc(t)}">${t}</button>`).join('')}<button type="button" class="chip" data-loc>📍 שלח איפה אני</button></div>
      <form class="chat-input" id="xChatForm"><input id="xChatInput" placeholder="כתבו הודעה לקבוצה…" autocomplete="off" maxlength="1500" aria-label="הודעה"><button class="btn btn-primary" type="submit">שלח</button></form></div>`;
    const input = el.querySelector('#xChatInput');
    const mic = micButton(input); if(mic) el.querySelector('#xChatForm').insertBefore(mic, input.nextSibling);
    const send = text => { text = String(text || '').trim(); if(!text) return; safe(addDoc(col('messages'), { text: text.slice(0, 1500), by: me(), ts: Date.now(), at: serverTimestamp() })); };
    el.querySelector('#xChatForm').addEventListener('submit', e => { e.preventDefault(); send(input.value); input.value = ''; input.focus(); });
    el.addEventListener('click', e => {
      const q = e.target.closest('[data-q]'); if(q) return send(q.dataset.q);
      if(e.target.closest('[data-loc]')){
        if(!navigator.geolocation) return toast('המכשיר לא תומך במיקום');
        navigator.geolocation.getCurrentPosition(p => send(`📍 אני כאן: https://maps.google.com/?q=${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => toast('לא קיבלתי אישור למיקום'), { enableHighAccuracy:true, timeout:15000 });
      }
      const del = e.target.closest('[data-del]'); if(del && confirm('למחוק את ההודעה?')) safe(deleteDoc(ref('messages', del.dataset.del)));
    });
  },
  polls(el){
    el.innerHTML = `<details class="fold"><summary>➕ הצבעה חדשה</summary><div class="fold-body">
      <label class="field"><span>על מה מצביעים?</span><input id="xPollQ" placeholder="למשל: איפה אוכלים בערב?" maxlength="200"></label>
      <label class="field"><span>האפשרויות (כל אפשרות בשורה נפרדת)</span><textarea id="xPollO" rows="4" placeholder="פיצה&#10;סושי&#10;המבורגר"></textarea></label>
      <button class="btn btn-primary btn-block" type="button" id="xPollGo">פתח הצבעה</button></div></details><div id="xPolls"></div>`;
    el.querySelector('#xPollGo').addEventListener('click', () => {
      const q = el.querySelector('#xPollQ').value.trim();
      const options = el.querySelector('#xPollO').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
      if(!q || options.length < 2) return toast('צריך שאלה ולפחות שתי אפשרויות');
      safe(addDoc(col('polls'), { q, options, votes:{}, closed:false, by: me(), ts: Date.now() }));
      el.querySelector('#xPollQ').value = ''; el.querySelector('#xPollO').value = ''; el.querySelector('details').open = false;
      TP.logActivityEvent('poll', `${TP.myName || 'מישהו'} פתח/ה הצבעה: ${q}`);
    });
    el.addEventListener('click', e => {
      const v = e.target.closest('[data-vote]');
      if(v){ const p = S.polls.find(x => x.id === v.dataset.poll); if(!p || p.closed) return;
        const i = Number(v.dataset.vote); return safe(updateDoc(ref('polls', p.id), { ['votes.' + me()]: p.votes?.[me()] === i ? deleteField() : i })); }
      const c = e.target.closest('[data-close-poll]'); if(c) return safe(updateDoc(ref('polls', c.dataset.closePoll), { closed: c.dataset.to === '1' }));
      const d = e.target.closest('[data-del]'); if(d && confirm('למחוק את ההצבעה?')) safe(deleteDoc(ref('polls', d.dataset.del)));
    });
  },
  money(el){
    el.innerHTML = `<div class="card" id="xBal"></div>
      <details class="fold"><summary>➕ הוצאה חדשה</summary><div class="fold-body">
      <label class="field"><span>על מה?</span><input id="xExD" placeholder="למשל: ארוחת ערב" maxlength="120"></label>
      <div class="field-row"><label class="field"><span>כמה?</span><input id="xExA" type="number" min="0" step="0.01" inputmode="decimal"></label>
      <label class="field"><span>מטבע</span><select id="xExC">${TP.CURRENCIES.map(c => `<option value="${c.code}" ${c.code === TP.state.currency ? 'selected' : ''}>${c.symbol} ${c.label}</option>`).join('')}</select></label></div>
      <label class="field"><span>מי שילם?</span><select id="xExP">${memberOptions(me())}</select></label>
      <div class="field"><span>בין מי מתחלקים?</span><div class="chips" id="xExW">${memberUids().map(u => `<label class="chip"><input type="checkbox" value="${esc(u)}" checked> ${esc(nameOf(u))}</label>`).join('')}</div></div>
      <button class="btn btn-primary btn-block" type="button" id="xExGo">הוסף הוצאה</button></div></details><div id="xExList"></div>`;
    el.querySelector('#xExGo').addEventListener('click', () => {
      const desc = el.querySelector('#xExD').value.trim(); const amount = Number(el.querySelector('#xExA').value);
      const among = [...el.querySelectorAll('#xExW input:checked')].map(i => i.value);
      if(!desc || !(amount > 0) || !among.length) return toast('מלאו תיאור, סכום ולפחות משתתף אחד');
      safe(addDoc(col('expenses'), { desc, amount, cur: el.querySelector('#xExC').value, paidBy: el.querySelector('#xExP').value, among, by: me(), ts: Date.now() }));
      el.querySelector('#xExD').value = ''; el.querySelector('#xExA').value = ''; el.querySelector('details').open = false;
    });
    el.addEventListener('click', e => {
      const st = e.target.closest('[data-settle]');
      if(st){ const [from, to, amt] = st.dataset.settle.split('|');
        if(confirm(`לסמן ש-${nameOf(from)} העביר/ה ${money(amt)} ל-${nameOf(to)}?`)) safe(addDoc(col('expenses'), { desc:'העברה', amount:Number(amt), cur:TP.state.currency, paidBy:from, among:[to], settle:true, by: me(), ts: Date.now() })); }
      const d = e.target.closest('[data-del]'); if(d && confirm('למחוק את ההוצאה?')) safe(deleteDoc(ref('expenses', d.dataset.del)));
      if(e.target.closest('[data-share-bal]')) share(balanceText(), 'חשבון הטיול');
    });
  },
  tasks(el){
    el.innerHTML = `<div class="card"><div class="card-title">משימה חדשה</div>
      <label class="field"><span>מה צריך לעשות?</span><input id="xTaT" placeholder="למשל: להזמין רכב שכור" maxlength="200"></label>
      <div class="field-row"><label class="field"><span>מי אחראי?</span><select id="xTaW"><option value="">כולם</option>${memberOptions('')}</select></label>
      <label class="field"><span>עד מתי?</span><input id="xTaD" type="date"></label></div>
      <button class="btn btn-primary btn-block" type="button" id="xTaGo">הוסף משימה</button></div><div id="xTasks"></div>`;
    el.querySelector('#xTaGo').addEventListener('click', () => {
      const text = el.querySelector('#xTaT').value.trim(); if(!text) return toast('כתבו מה צריך לעשות');
      safe(addDoc(col('tasks'), { text, to: el.querySelector('#xTaW').value, due: el.querySelector('#xTaD').value, done:false, by: me(), ts: Date.now() }));
      el.querySelector('#xTaT').value = '';
    });
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-toggle]');
      if(t){ const x = S.tasks.find(k => k.id === t.dataset.toggle); if(x) safe(updateDoc(ref('tasks', x.id), { done: !x.done, doneBy: !x.done ? me() : '' })); return; }
      const mine = e.target.closest('[data-take]'); if(mine) return safe(updateDoc(ref('tasks', mine.dataset.take), { to: me() }));
      const d = e.target.closest('[data-del]'); if(d && confirm('למחוק את המשימה?')) safe(deleteDoc(ref('tasks', d.dataset.del)));
    });
  },
  bring(el){
    el.innerHTML = `<div class="card"><div class="card-title">ציוד משותף - מי מביא מה?</div><p class="hint">דברים שמספיק שאחד מהקבוצה יביא (מטען, קרם הגנה, משחקים…). הרשימה האישית שלכם נמצאת ב"עוד" ← "רשימת אריזה".</p>
      <form class="chat-input" id="xBrForm"><input id="xBrT" placeholder="מה צריך להביא?" maxlength="120" aria-label="פריט"><button class="btn btn-primary" type="submit">הוסף</button></form></div><div id="xBring"></div>`;
    el.querySelector('#xBrForm').addEventListener('submit', e => {
      e.preventDefault(); const i = el.querySelector('#xBrT'); const text = i.value.trim(); if(!text) return;
      safe(addDoc(col('sharedPacking'), { text, who:'', by: me(), ts: Date.now() })); i.value = '';
    });
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-take]');
      if(t){ const x = S.shared.find(k => k.id === t.dataset.take); if(x) safe(updateDoc(ref('sharedPacking', x.id), { who: x.who === me() ? '' : me() })); return; }
      const d = e.target.closest('[data-del]'); if(d && confirm('למחוק את הפריט?')) safe(deleteDoc(ref('sharedPacking', d.dataset.del)));
    });
  },
  people(el){
    el.innerHTML = '';
    const ex = $('grpMembersExtra');
    if(!ex.dataset.wired){
      ex.dataset.wired = '1';
      ex.addEventListener('click', e => {
        if(e.target.closest('[data-leave]')) return $('deleteTripBtn').click();
        if(e.target.closest('[data-loc-toggle]')) return geoWatch === null ? startLocation() : stopLocation();
        if(e.target.closest('[data-edit-me]')) return openSettings();
      });
      ex.addEventListener('change', e => {
        const r = e.target.closest('[data-role-of]');
        if(r && confirm(`לשנות את ההרשאה של ${nameOf(r.dataset.roleOf)}?`)) safe(TP.setRole(r.dataset.roleOf, r.value)).then(() => UPDATE.people());
        else if(r) UPDATE.people();
      });
      $('inviteArea').addEventListener('click', e => {
        const k = e.target.closest('[data-inv-role]'); if(k){ inviteRole = k.dataset.invRole; return renderInvite(); }
        const link = inviteLink(); if(!link) return;
        const text = `הצטרפו לטיול "${TP.state.name || 'שלנו'}" ב-triplan:\n${link}`;
        if(e.target.closest('[data-inv="copy"]')) copyText(link);
        else if(e.target.closest('[data-inv="share"]')) share(text, 'הזמנה לטיול');
        else if(e.target.closest('[data-inv="wa"]')) window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
        else if(e.target.closest('[data-inv="qr"]')) sheet('סרקו כדי להצטרף', '<div class="qr-box" id="xQr"></div><p class="hint" style="text-align:center">פותחים את המצלמה בטלפון השני ומכוונים לכאן.</p>', body => {
          if(window.QRCode) new window.QRCode(body.querySelector('#xQr'), { text: link, width: 240, height: 240 }); else body.querySelector('#xQr').textContent = link;
        });
      });
    }
  },
  feed(el){ el.innerHTML = '<div class="card"><div class="card-title">מה קרה לאחרונה בטיול</div><div id="xFeed"></div></div>'; }
};

let inviteRole = 'editor';
function inviteLink(){ const code = (TP.codes || {})[inviteRole]; return code ? `${location.origin}${location.pathname}?join=${code}` : ''; }
function renderInvite(){
  const el = $('inviteArea'); if(!el) return;
  if(TP.role === 'viewer' || !inviteLink()){ el.innerHTML = '<p class="hint">רק מי שמנהל או עורך את הטיול יכול להזמין אנשים נוספים.</p>'; return; }
  el.innerHTML = `<p class="hint">שולחים קישור, והאדם השני פשוט לוחץ עליו ומצטרף.</p>
    <div class="seg"><button type="button" data-inv-role="editor" class="${inviteRole === 'editor' ? 'active' : ''}">✏️ יכול/ה לערוך</button><button type="button" data-inv-role="viewer" class="${inviteRole === 'viewer' ? 'active' : ''}">👁️ רק לצפות</button></div>
    <div class="tile-grid">
      <button class="tile" type="button" data-inv="wa"><span class="em">🟢</span>שלח בוואטסאפ</button>
      <button class="tile" type="button" data-inv="share"><span class="em">📤</span>שלח בדרך אחרת</button>
      <button class="tile" type="button" data-inv="qr"><span class="em">🔳</span>הצג קוד לסריקה</button>
      <button class="tile" type="button" data-inv="copy"><span class="em">📋</span>העתק קישור</button>
    </div>
    <div class="code-row"><span>קוד ההצטרפות:</span><b dir="ltr">${esc(TP.codes[inviteRole])}</b></div>`;
}

function balances(){
  const bal = {}; memberUids().forEach(u => { bal[u] = 0; });
  let total = 0;
  S.expenses.forEach(x => {
    const amt = TP.convertAmount(x.amount, x.cur || TP.state.currency, TP.state.currency);
    const among = (x.among || []).filter(Boolean); if(!among.length || !amt) return;
    if(!x.settle) total += amt;
    bal[x.paidBy] = (bal[x.paidBy] || 0) + amt;
    among.forEach(u => { bal[u] = (bal[u] || 0) - amt / among.length; });
  });
  const debt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([u, v]) => [u, -v]).sort((a, b) => b[1] - a[1]);
  const cred = Object.entries(bal).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const moves = []; let i = 0, j = 0;
  while(i < debt.length && j < cred.length){
    const m = Math.min(debt[i][1], cred[j][1]);
    moves.push({ from: debt[i][0], to: cred[j][0], amount: Math.round(m * 100) / 100 });
    debt[i][1] -= m; cred[j][1] -= m;
    if(debt[i][1] < 0.5) i++; if(cred[j][1] < 0.5) j++;
  }
  return { bal, moves, total };
}
function balanceText(){
  const { moves, total } = balances();
  return `חשבון הטיול "${TP.state.name || ''}"\nסה"כ הוצאות משותפות: ${money(total)}\n` + (moves.length ? moves.map(m => `${nameOf(m.from)} מעביר/ה ל${nameOf(m.to)}: ${money(m.amount)}`).join('\n') : 'כולם מאוזנים 👍');
}

const UPDATE = {
  chat(){
    const el = $('xChat'); if(!el) return;
    el.innerHTML = S.messages.length ? S.messages.map(m => `<div class="chat-msg ${m.by === me() ? 'mine' : ''}">
      ${m.by === me() ? '' : `<div class="who">${avatar(m.by, 'sm')} ${esc(nameOf(m.by))}</div>`}<div class="txt">${linkify(m.text || '')}</div>
      <div class="when">${new Date(m.ts || Date.now()).toLocaleString('he-IL', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' })}${canDelete(m) ? ` · <button type="button" class="link-btn" data-del="${esc(m.id)}">מחק</button>` : ''}</div></div>`).join('')
      : '<div class="empty">עוד אין הודעות. כתבו משהו לקבוצה 👋</div>';
    el.scrollTop = el.scrollHeight;
    if(chatVisible()) markSeen();
  },
  polls(){
    const el = $('xPolls'); if(!el) return;
    el.innerHTML = S.polls.length ? S.polls.map(p => {
      const votes = p.votes || {}; const total = Object.keys(votes).length;
      return `<div class="card poll"><div class="card-title">${esc(p.q)}${p.closed ? ' <span class="chip">נסגרה</span>' : ''}</div>
        ${(p.options || []).map((o, i) => { const who = Object.keys(votes).filter(u => votes[u] === i); const pct = total ? Math.round(who.length / total * 100) : 0;
          return `<button type="button" class="poll-opt ${votes[me()] === i ? 'mine' : ''}" data-poll="${esc(p.id)}" data-vote="${i}" ${p.closed ? 'disabled' : ''} data-viewer-ok><i style="width:${pct}%"></i><span>${votes[me()] === i ? '✔ ' : ''}${esc(o)}</span><span class="cnt">${who.length}</span></button>${who.length ? `<small class="poll-who">${esc(who.map(nameOf).join(', '))}</small>` : ''}`; }).join('')}
        <div class="poll-foot"><small>${esc(nameOf(p.by))} · ${total} הצביעו מתוך ${memberUids().length}</small>
        ${canDelete(p) ? `<span><button type="button" class="btn btn-sm btn-ghost" data-close-poll="${esc(p.id)}" data-to="${p.closed ? 0 : 1}">${p.closed ? 'פתח מחדש' : 'סגור הצבעה'}</button> <button type="button" class="btn btn-sm btn-danger" data-del="${esc(p.id)}">מחק</button></span>` : ''}</div></div>`;
    }).join('') : '<div class="empty">אין הצבעות עדיין. פתחו הצבעה כדי להחליט יחד.</div>';
  },
  money(){
    const b = $('xBal'), l = $('xExList'); if(!b || !l) return;
    const { bal, moves, total } = balances();
    b.innerHTML = `<div class="card-title">מי חייב למי</div><div class="kv"><span>סה"כ הוצאות משותפות</span><b>${money(total)}</b></div>
      ${memberUids().map(u => `<div class="list-row">${avatar(u, 'sm')}<span class="grow">${esc(nameOf(u))}</span><b class="${(bal[u] || 0) >= 0 ? 'balance-pos' : 'balance-neg'}">${(bal[u] || 0) > 0.5 ? 'מגיע לו/ה ' + money(bal[u]) : (bal[u] || 0) < -0.5 ? 'חייב/ת ' + money(-bal[u]) : 'מאוזן ✔'}</b></div>`).join('')}
      ${moves.length ? '<div class="card-title" style="margin-top:.8rem">איך סוגרים חשבון</div>' + moves.map(m => `<div class="settle-row"><span>${esc(nameOf(m.from))} ← ${esc(nameOf(m.to))}: <b>${money(m.amount)}</b></span><button type="button" class="btn btn-sm btn-primary" data-settle="${esc(m.from)}|${esc(m.to)}|${m.amount}">שולם ✔</button></div>`).join('') : ''}
      ${S.expenses.length ? '<button type="button" class="btn btn-ghost btn-block" data-share-bal>📤 שלח את החשבון לקבוצה</button>' : ''}`;
    l.innerHTML = S.expenses.length ? S.expenses.map(x => `<div class="list-row"><span class="grow"><span class="title">${x.settle ? '🔁 ' : ''}${esc(x.desc)}</span><span class="sub">${esc(nameOf(x.paidBy))} ${x.settle ? 'העביר/ה ל' + esc((x.among || []).map(nameOf).join(', ')) : 'שילם/ה · מתחלק בין ' + (x.among || []).length} · ${ago(x.ts)}</span></span>
      <span class="amt">${money(x.amount, x.cur)}</span>${canDelete(x) || TP.role === 'editor' ? `<button type="button" class="icon-btn" data-del="${esc(x.id)}" aria-label="מחק">🗑</button>` : ''}</div>`).join('')
      : '<div class="empty">עוד לא נרשמו הוצאות משותפות.</div>';
  },
  tasks(){
    const el = $('xTasks'); if(!el) return;
    const sorted = [...S.tasks].sort((a, b) => (a.done - b.done) || (a.due || '9').localeCompare(b.due || '9'));
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = sorted.length ? sorted.map(t => `<div class="check-row ${t.done ? 'is-done' : ''}">
      <button type="button" class="act-check" aria-pressed="${!!t.done}" data-toggle="${esc(t.id)}" aria-label="סמן כבוצע">✓</button>
      <span class="check-text"><span>${esc(t.text)}</span><span class="check-meta">${t.to ? '👤 ' + esc(nameOf(t.to)) : '👥 כולם'}${t.due ? ` · <span class="${!t.done && t.due < today ? 'balance-neg' : ''}">עד ${new Date(t.due + 'T00:00:00').toLocaleDateString('he-IL', { day:'numeric', month:'short' })}</span>` : ''}${t.done && t.doneBy ? ' · בוצע ע"י ' + esc(nameOf(t.doneBy)) : ''}</span></span>
      ${!t.to && !t.done ? `<button type="button" class="btn btn-sm btn-ghost" data-take="${esc(t.id)}">אני על זה</button>` : ''}
      ${canDelete(t) || TP.role === 'editor' ? `<button type="button" class="icon-btn" data-del="${esc(t.id)}" aria-label="מחק">🗑</button>` : ''}</div>`).join('')
      : '<div class="empty">אין משימות פתוחות. 🎉</div>';
  },
  bring(){
    const el = $('xBring'); if(!el) return;
    el.innerHTML = S.shared.length ? S.shared.map(x => `<div class="check-row ${x.who ? 'is-done' : ''}">
      <span class="check-text"><span>${esc(x.text)}</span><span class="check-meta">${x.who ? '✔ ' + esc(nameOf(x.who)) + ' מביא/ה' : '❓ עוד אף אחד לא לקח'}</span></span>
      <button type="button" class="btn btn-sm ${x.who === me() ? 'btn-ghost' : 'btn-primary'}" data-take="${esc(x.id)}">${x.who === me() ? 'בטל' : 'אני מביא/ה'}</button>
      ${canDelete(x) || TP.role === 'editor' ? `<button type="button" class="icon-btn" data-del="${esc(x.id)}" aria-label="מחק">🗑</button>` : ''}</div>`).join('')
      : '<div class="empty">הרשימה ריקה. הוסיפו פריט ראשון.</div>';
  },
  people(){
    renderInvite();
    try{ TP.renderSharingPanel(); }catch(e){ console.warn(e); }
    const ex = $('grpMembersExtra'); if(!ex) return;
    const roleLabel = { owner:'👑 מנהל/ת', editor:'✏️ עורך/ת', viewer:'👁️ צופה' };
    const locs = Object.entries(S.locations).filter(([u, l]) => l && l.lat && TP.members[u] && (l.ts || 0) > Date.now() - 6 * 3600e3);
    ex.innerHTML = `<div class="card"><div class="card-title">מי בטיול</div>
      ${Object.entries(TP.members || {}).map(([u, r]) => `<div class="member-row">${avatar(u)}<span class="grow"><b>${esc(nameOf(u))}</b>${u === me() ? ' (אני)' : ''}<br><small>${isOnline(u) ? '🟢 מחובר/ת עכשיו' : S.presence[u]?.ts ? 'נראה/תה ' + ago(S.presence[u].ts) : ''}</small></span>
        ${TP.role === 'owner' && u !== me() && r !== 'owner' ? `<select data-role-of="${esc(u)}" aria-label="הרשאה"><option value="editor" ${r === 'editor' ? 'selected' : ''}>✏️ עורך/ת</option><option value="viewer" ${r === 'viewer' ? 'selected' : ''}>👁️ צופה</option></select>` : `<span class="chip">${roleLabel[r] || r}</span>`}</div>`).join('')}
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-edit-me>🙂 שינוי השם והסמל שלי</button>${TP.role !== 'owner' ? '<button type="button" class="btn btn-danger" data-leave>🚪 עזוב את הטיול</button>' : ''}</div></div>
      <div class="card"><div class="card-title">📍 איפה כולם?</div><p class="hint">אפשר לשתף את המיקום שלכם עם הקבוצה בזמן הטיול, כדי שיהיה קל להיפגש. השיתוף פועל רק כשהמסך הזה פתוח, ואפשר להפסיק בכל רגע.</p>
      <button type="button" class="btn ${geoWatch === null ? 'btn-primary' : 'btn-danger'} btn-block" data-loc-toggle>${geoWatch === null ? '📍 שתף את המיקום שלי' : '⏹ הפסק לשתף מיקום'}</button>
      ${locs.length ? locs.map(([u, l]) => `<div class="list-row">${avatar(u, 'sm')}<span class="grow"><span class="title">${esc(nameOf(u))}</span><span class="sub">עודכן ${ago(l.ts)}</span></span><a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}">פתח במפה</a></div>`).join('') + '<div id="xLocMap" style="height:260px;border-radius:14px;margin-top:.6rem"></div>' : '<div class="empty">אף אחד לא משתף מיקום כרגע.</div>'}</div>`;
    if(locs.length && window.L){
      try{
        const map = window.L.map('xLocMap', { attributionControl:false });
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);
        const pts = locs.map(([u, l]) => { window.L.marker([l.lat, l.lng]).addTo(map).bindTooltip(nameOf(u), { permanent:true }); return [l.lat, l.lng]; });
        map.fitBounds(pts, { padding:[40, 40], maxZoom:15 });
      }catch(e){ console.warn(e); }
    }
  },
  feed(){
    const el = $('xFeed'); if(!el) return;
    el.innerHTML = S.feed.length ? S.feed.map(f => `<div class="feed-item">${avatar(f.by, 'sm')}<span class="grow">${esc(f.text || '')}</span><small>${ago(f.createdAt?.toMillis?.())}</small></div>`).join('') : '<div class="empty">עוד לא קרה כלום. כשמישהו יוסיף או ישנה משהו, זה יופיע כאן.</div>';
  }
};

function startLocation(){
  if(!navigator.geolocation) return toast('המכשיר לא תומך במיקום');
  let last = 0;
  geoWatch = navigator.geolocation.watchPosition(p => {
    if(Date.now() - last < 20000) return; last = Date.now();
    setDoc(ref('locations', me()), { lat: p.coords.latitude, lng: p.coords.longitude, ts: Date.now() }).catch(() => {});
  }, () => { toast('לא קיבלתי אישור למיקום'); stopLocation(); }, { enableHighAccuracy:true, maximumAge:15000 });
  toast('📍 המיקום שלך משותף עם הקבוצה'); segUpdate('people');
}
function stopLocation(silent){
  if(geoWatch !== null){ navigator.geolocation.clearWatch(geoWatch); geoWatch = null;
    if(TP.tripId && me()) deleteDoc(ref('locations', me())).catch(() => {});
    if(!silent){ toast('שיתוף המיקום הופסק'); segUpdate('people'); } }
}

/* ================= tools ================= */
function buildTools(){
  const el = $('toolsExtra'); if(!el || el.dataset.built) return; el.dataset.built = '1';
  const curOpts = sel => TP.CURRENCIES.map(c => `<option value="${c.code}" ${c.code === sel ? 'selected' : ''}>${c.symbol} ${c.label}</option>`).join('');
  el.innerHTML = `
    <div class="card"><div class="card-title">💱 המרת מטבע</div>
      <div class="field-row"><label class="field"><span>סכום</span><input id="tcA" type="number" inputmode="decimal" value="100"></label>
      <label class="field"><span>ממטבע</span><select id="tcF">${curOpts(TP.state.secondaryCurrency || 'EUR')}</select></label>
      <label class="field"><span>למטבע</span><select id="tcT">${curOpts(TP.state.currency || 'ILS')}</select></label></div>
      <div class="big-result" id="tcR"></div><p class="hint">שער משוער בלבד.</p></div>
    <div class="card"><div class="card-title">🧾 חשבון במסעדה - טיפ וחלוקה</div>
      <div class="field-row"><label class="field"><span>סכום החשבון</span><input id="ttA" type="number" inputmode="decimal"></label>
      <label class="field"><span>טיפ %</span><input id="ttP" type="number" inputmode="numeric" value="12"></label>
      <label class="field"><span>כמה אנשים</span><input id="ttN" type="number" inputmode="numeric" value="${Math.max(1, memberUids().length)}" min="1"></label></div>
      <div class="big-result" id="ttR"></div></div>
    <div class="card"><div class="card-title">🚕 הראה לנהג / למוכר</div><p class="hint">כותבים כתובת או משפט, והוא מוצג באותיות ענקיות על כל המסך.</p>
      <div class="chat-input" id="tsRow"><input id="tsT" placeholder="למשל: שם המלון והכתובת" aria-label="טקסט להצגה"><button class="btn btn-primary" type="button" id="tsGo">הצג</button></div>
      <div class="chips" id="tsHotels"></div></div>
    <div class="card"><div class="card-title">🆘 מספרי חירום בעולם</div>
      <div class="kv"><span>אירופה ורוב העולם</span><a class="btn btn-sm btn-danger" href="tel:112">112</a></div>
      <div class="kv"><span>ארה"ב וקנדה</span><a class="btn btn-sm btn-danger" href="tel:911">911</a></div>
      <div class="kv"><span>בריטניה</span><a class="btn btn-sm btn-danger" href="tel:999">999</a></div>
      <div class="kv"><span>ישראל - משטרה / מד"א / כיבוי</span><span><a class="btn btn-sm btn-danger" href="tel:100">100</a> <a class="btn btn-sm btn-danger" href="tel:101">101</a> <a class="btn btn-sm btn-danger" href="tel:102">102</a></span></div>
      <div class="kv"><span>יפן - משטרה / אמבולנס</span><span><a class="btn btn-sm btn-danger" href="tel:110">110</a> <a class="btn btn-sm btn-danger" href="tel:119">119</a></span></div>
      <div class="kv"><span>תאילנד - משטרת תיירים</span><a class="btn btn-sm btn-danger" href="tel:1155">1155</a></div>
      <div class="kv"><span>אוסטרליה</span><a class="btn btn-sm btn-danger" href="tel:000">000</a></div>
      <button class="btn btn-ghost btn-block" type="button" id="tSos">🆘 כרטיס החירום האישי שלי</button></div>`;
  const conv = () => { const a = Number($('tcA').value) || 0; $('tcR').textContent = money(a, $('tcF').value) + ' = ' + money(TP.convertAmount(a, $('tcF').value, $('tcT').value), $('tcT').value); };
  ['tcA','tcF','tcT'].forEach(i => $(i).addEventListener('input', conv)); conv();
  const tip = () => { const a = Number($('ttA').value) || 0, p = Number($('ttP').value) || 0, n = Math.max(1, Number($('ttN').value) || 1); const tot = a * (1 + p / 100);
    $('ttR').innerHTML = a ? `סה"כ עם טיפ: <b>${tot.toFixed(2)}</b><br>לכל אחד: <b>${(tot / n).toFixed(2)}</b>` : ''; };
  ['ttA','ttP','ttN'].forEach(i => $(i).addEventListener('input', tip));
  const mic = micButton($('tsT')); if(mic) $('tsRow').insertBefore(mic, $('tsGo'));
  $('tsGo').addEventListener('click', () => showBig($('tsT').value));
  $('tsHotels').addEventListener('click', e => { const c = e.target.closest('[data-t]'); if(c) showBig(c.dataset.t); });
  $('tSos').addEventListener('click', () => openNotes(true));
}
function refreshTools(){
  const h = $('tsHotels'); if(!h) return;
  const names = [...new Set(TP.state.days.map(d => d.hotel?.name).filter(Boolean))];
  h.innerHTML = names.map(n => `<button type="button" class="chip" data-t="${esc(n)}">🛏 ${esc(n)}</button>`).join('');
}
function showBig(text){
  text = String(text || '').trim(); if(!text) return toast('כתבו קודם מה להציג');
  sheet('להראות לנהג', `<div class="show-big"><div class="txt" dir="auto">${esc(text)}</div></div>`);
}

/* ================= private notes + SOS card ================= */
const SOS_FIELDS = [['name','השם המלא שלי'],['contact','איש קשר לחירום (שם וטלפון)'],['blood','סוג דם'],['meds','תרופות / אלרגיות'],['insurance','ביטוח נסיעות (חברה, מספר פוליסה, טלפון)'],['passport','מספר דרכון'],['embassy','טלפון השגרירות / הקונסוליה']];
async function openNotes(sosFirst){
  if(!TP.tripId || !me()) return;
  let data = {};
  try{ const s = await getDoc(ref('privateNotes', me())); if(s.exists()) data = s.data(); }catch(e){ console.warn(e); }
  const sos = data.sos || {};
  const notesHTML = `<div class="card"><div class="card-title">📝 הפתקים שלי</div><p class="hint">רק אתם רואים את מה שכתוב כאן.</p><textarea id="pnText" rows="8" style="width:100%" placeholder="דברים שחשוב לי לזכור…">${esc(data.notes || '')}</textarea></div>`;
  const sosHTML = `<div class="card"><div class="card-title">🆘 כרטיס חירום</div><p class="hint">פרטים שיעזרו במקרה חירום. נשמר רק אצלכם.</p>${SOS_FIELDS.map(([k, l]) => `<label class="field"><span>${l}</span><input data-sos="${k}" value="${esc(sos[k] || '')}"></label>`).join('')}
    <button class="btn btn-ghost btn-block" type="button" id="pnShow">🔎 הצג בגדול (להראות למישהו)</button></div>`;
  sheet(sosFirst ? 'כרטיס חירום' : 'הפתקים שלי', (sosFirst ? sosHTML + notesHTML : notesHTML + sosHTML) + '<p class="hint" id="pnState">נשמר אוטומטית</p>', body => {
    let t = null;
    const collect = () => { const o = {}; body.querySelectorAll('[data-sos]').forEach(i => { o[i.dataset.sos] = i.value; }); return o; };
    body.addEventListener('input', () => {
      body.querySelector('#pnState').textContent = 'שומר…'; clearTimeout(t);
      t = setTimeout(() => setDoc(ref('privateNotes', me()), { notes: body.querySelector('#pnText').value, sos: collect(), ts: Date.now() }).then(() => { const s = body.querySelector('#pnState'); if(s) s.textContent = 'נשמר ✔'; }, () => toast('השמירה נכשלה')), 700);
    });
    body.querySelector('#pnShow').addEventListener('click', () => { const o = collect(); showBig(SOS_FIELDS.filter(([k]) => o[k]).map(([k, l]) => `${l}: ${o[k]}`).join('\n') || 'הכרטיס ריק'); });
  });
}

/* ================= search ================= */
function openSearch(){
  sheet('חיפוש בטיול', `<input id="sQ" placeholder="מה מחפשים? (מקום, פעילות, פריט…)" style="width:100%" aria-label="חיפוש"><div id="sR"></div>`, (body, close) => {
    const q = body.querySelector('#sQ'); const r = body.querySelector('#sR');
    const run = () => {
      const t = q.value.trim().toLowerCase(); if(t.length < 2){ r.innerHTML = '<div class="empty">הקלידו לפחות שתי אותיות.</div>'; return; }
      const hit = s => String(s || '').toLowerCase().includes(t); const out = [];
      TP.state.days.forEach((d, i) => {
        if(hit(d.destination) || hit(d.hotel?.name)) out.push({ k:'day', i, t:`יום ${i + 1}: ${d.destination || d.hotel?.name}`, s:'📅 לוח זמנים' });
        d.activities.forEach(a => { if(hit(a.title) || hit(a.notes)) out.push({ k:'act', i, id:a.id, t:a.title || a.notes, s:`📅 יום ${i + 1}${a.time ? ' · ' + a.time : ''}` }); });
      });
      (TP.state.attractionIdeas || []).forEach(x => { if(hit(x.nameHe) || hit(x.nameEn) || hit(x.notes)) out.push({ k:'idea', id:x.id, t:x.nameHe || x.nameEn, s:'💡 רעיון' }); });
      (TP.packing || []).forEach(p => { if(hit(p.text)) out.push({ k:'pack', t:p.text, s:'🎒 רשימת אריזה' }); });
      (TP.state.documents || []).forEach(d => { if(hit(d.title) || hit(d.name) || hit(d.notes)) out.push({ k:'doc', id:d.id, t:d.title || d.name || 'מסמך', s:'📄 מסמך' }); });
      S.tasks.forEach(x => { if(hit(x.text)) out.push({ k:'grp', seg:'tasks', t:x.text, s:'✅ משימה' }); });
      S.messages.forEach(m => { if(hit(m.text)) out.push({ k:'grp', seg:'chat', t:m.text, s:'💬 ' + nameOf(m.by) }); });
      r.innerHTML = out.length ? out.slice(0, 40).map((o, n) => `<button type="button" class="search-res" data-n="${n}"><b>${esc(String(o.t || '').slice(0, 80))}</b><small>${esc(o.s)}</small></button>`).join('') : '<div class="empty">לא נמצא כלום.</div>';
      r.onclick = e => { const b = e.target.closest('[data-n]'); if(!b) return; const o = out[Number(b.dataset.n)]; close();
        if(o.k === 'day' || o.k === 'act'){ if(o.id) TP.expandActivity(o.id); TP.setActiveTab('days'); TP.goToDay(o.i); if(o.id){ TP.render(); setTimeout(() => document.querySelector(`.activity[data-act-id="${o.id}"]`)?.scrollIntoView({ block:'center' }), 80); } }
        else if(o.k === 'idea'){ TP.expandIdea(o.id); TP.renderAttractions(); TP.setActiveTab('ideas'); setTimeout(() => document.querySelector(`.idea-card[data-idea-id="${o.id}"]`)?.scrollIntoView({ block:'center' }), 80); }
        else if(o.k === 'pack') TP.setActiveTab('packing');
        else if(o.k === 'doc'){ TP.expandDoc(o.id); TP.render(); TP.setActiveTab('budget'); }
        else if(o.k === 'grp') openGroup(o.seg); };
    };
    q.addEventListener('input', run); run(); q.focus();
  });
}

/* ================= calendar file, trip summary, stats ================= */
function exportICS(){
  const s = TP.state; if(!s.startDate) return toast('קודם קבעו תאריך התחלה לטיול');
  const e = t => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//triplan//HE', 'CALSCALE:GREGORIAN'];
  const nextDay = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join(''); };
  s.days.forEach((d, i) => {
    const iso = TP.dateForDayIndex(i); if(!iso) return; const ymd = iso.replace(/-/g, '');
    out.push('BEGIN:VEVENT', `UID:${d.id}@triplan`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${nextDay(iso)}`, `SUMMARY:${e((s.name || 'טיול') + ' - יום ' + (i + 1) + (d.destination ? ': ' + d.destination : ''))}`, `DESCRIPTION:${e(dayText(i))}`, 'END:VEVENT');
    actTitleList(d).filter(a => /^\d\d:\d\d$/.test(a.time || '')).forEach(a => {
      const st = a.time.replace(':', '') + '00'; const h = (Number(a.time.slice(0, 2)) + 1); const en = h > 23 ? '235900' : String(h).padStart(2, '0') + a.time.slice(3) + '00';
      out.push('BEGIN:VEVENT', `UID:${a.id}@triplan`, `DTSTAMP:${stamp}`, `DTSTART:${ymd}T${st}`, `DTEND:${ymd}T${en}`, `SUMMARY:${e(a.title)}`, `DESCRIPTION:${e(a.notes || '')}`, `LOCATION:${e(d.destination || '')}`, 'END:VEVENT');
    });
  });
  out.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.join('\r\n')], { type:'text/calendar' }));
  a.download = (s.name || 'trip') + '.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('קובץ היומן ירד. פתחו אותו כדי להוסיף ליומן.');
}
function openStats(){
  const s = TP.state; const acts = allActs(); const ideas = s.attractionIdeas || [];
  const cat = k => acts.filter(a => a.category === k).length;
  const rows = [['📅 ימים', s.days.length], ['🎯 פעילויות', acts.length], ['✓ בוצעו', acts.filter(a => S.done[a.id]).length], ['🏛️ אתרים', cat('sight')], ['🍽️ ארוחות', cat('food')], ['🚌 נסיעות', cat('transport')],
    ['💡 רעיונות', ideas.length], ['📌 רעיונות ששובצו', ideas.filter(i => i.scheduled).length], ['🛏 מקומות לינה', new Set(s.days.map(d => d.hotel?.name).filter(Boolean)).size],
    ['💰 עלות מתוכננת', money(TP.totalPlanned() || 0)], ['💸 הוצאות משותפות', money(balances().total)], ['👥 משתתפים', memberUids().length], ['💬 הודעות', S.messages.length], ['🗳️ הצבעות', S.polls.length]];
  sheet('הטיול במספרים', `<div class="dash-grid">${rows.map(([l, v]) => `<div class="kv"><span>${l}</span><b>${esc(v)}</b></div>`).join('')}</div>`);
}

$('moreTiles').addEventListener('click', e => {
  const b = e.target.closest('.tile'); if(!b) return;
  if(b.dataset.go) return TP.setActiveTab(b.dataset.go);
  const a = b.dataset.act;
  if(a === 'ai-guide') $('aiChatFab').click();
  else if(a === 'notes') openNotes(false);
  else if(a === 'sos') openNotes(true);
  else if(a === 'stats') openStats();
  else if(a === 'share-trip') share(`${TP.state.name || 'הטיול שלנו'}\n\n` + TP.state.days.map((d, i) => dayText(i)).join('\n\n'), TP.state.name);
  else if(a === 'ics') exportICS();
  else if(a === 'settings') openSettings();
  else if(a === 'help') openHelp();
});
$('mapFold')?.addEventListener('toggle', e => { if(e.target.open) setTimeout(() => TP.refreshMap(), 80); });

function renderPackingProgress(){
  const el = $('packingProgress'); if(!el) return;
  const pk = TP.packing || []; const d = pk.filter(p => p.checked).length;
  el.innerHTML = pk.length ? `<div class="card"><div class="kv"><span>ארזתם ${d} מתוך ${pk.length}</span><b>${Math.round(d / pk.length * 100)}%</b></div><div class="meter ${d === pk.length ? 'ok' : ''}"><i style="width:${Math.round(d / pk.length * 100)}%"></i></div></div>` : '';
}
const packingPanel = document.querySelector('[data-panel="packing"]');
packingPanel?.addEventListener('change', () => setTimeout(renderPackingProgress, 50));
packingPanel?.addEventListener('click', () => setTimeout(renderPackingProgress, 50));

function refreshAll(){
  updateTitle(); paintDone(); decorateIdeas(); renderDashboard(); renderPackingProgress(); refreshTools(); updateBadge();
  if(document.body.dataset.screen === 'home') renderHome();
  if(groupVisible()) renderGroup();
}

/* ================= hooks called by the core app ================= */
let joinHandled = false;
window.TPX = {
  doneMap: () => S.done, setDone, dayAction, pickDay, voteCount, decorateIdeas,
  onRender(){ updateTitle(); paintDone(); renderDashboard(); renderPackingProgress(); refreshTools(); },
  onTrips(){ renderHome(); },
  onAccount(){ if(document.body.dataset.screen === 'home') renderHome(); },
  onSync(show){ syncErr = !!show; paintSync(); },
  onTab(tab){ if(tab === 'group') renderGroup(); else if(tab === 'overview') renderDashboard(); else if(tab === 'tools'){ buildTools(); refreshTools(); } updateBadge(); },
  onTripSwitched(){
    subscribe(); buildTools(); refreshAll();
    if(!joinHandled){
      joinHandled = true;
      const code = new URLSearchParams(location.search).get('join');
      if(code){
        history.replaceState(null, '', location.pathname);
        setScreen('trip'); $('joinCodeInput').value = code; $('joinCodeBtn').click();
      }
    }
  }
};
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') updateBadge(); });
setScreen(lsGet(SCREEN_KEY, 'trip') === 'home' && !new URLSearchParams(location.search).get('join') ? 'home' : 'trip');
if(TP.tripId){ window.TPX.onTripSwitched(); }
}
