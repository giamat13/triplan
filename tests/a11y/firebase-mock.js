// In-memory stand-in for the Firebase web SDK, used only by the automated
// browser test (run.mjs). The test serves this one file for every
// https://www.gstatic.com/firebasejs/... module the app imports, so the app
// runs end to end without touching a real Firebase project: no sign-in, no
// writes, no AI calls. Every module instance shares one store on globalThis.

const G = globalThis.__fbMock || (globalThis.__fbMock = {
  docs: new Map(),          // 'trips/abc' -> plain object
  listeners: new Set(),     // live onSnapshot subscriptions
  authCallbacks: new Set(),
  auth: { currentUser: null },
  seq: 0,
  seeded: false,
});

if(!G.seeded){
  G.seeded = true;
  const seed = globalThis.__fbSeed || {};
  for(const [path, data] of Object.entries(seed)) G.docs.set(path, data);
}

/* ---------------- helpers ---------------- */
class Timestamp {
  constructor(ms){ this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis(){ return this._ms; }
  toDate(){ return new Date(this._ms); }
}
const DELETE = { __mock: 'delete' };
const SERVER_TS = { __mock: 'serverTimestamp' };

function clone(v){
  if(v instanceof Timestamp) return v;
  if(Array.isArray(v)) return v.map(clone);
  if(v && typeof v === 'object'){ const o = {}; for(const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
}
function resolveValue(v){
  if(v === SERVER_TS) return new Timestamp(Date.now() + (G.seq++));
  if(Array.isArray(v)) return v.map(resolveValue);
  if(v && typeof v === 'object' && !(v instanceof Timestamp) && v !== DELETE){
    const o = {}; for(const k of Object.keys(v)) o[k] = resolveValue(v[k]); return o;
  }
  return v;
}
function setPath(obj, dotted, value){
  const parts = dotted.split('.');
  let cur = obj;
  for(let i = 0; i < parts.length - 1; i++){
    if(!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if(value === DELETE) delete cur[last]; else cur[last] = resolveValue(value);
}
function getPath(obj, dotted){
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function deepMerge(target, src){
  for(const k of Object.keys(src)){
    const v = src[k];
    if(v === DELETE){ delete target[k]; continue; }
    if(v && typeof v === 'object' && !Array.isArray(v) && v !== SERVER_TS && !(v instanceof Timestamp)){
      if(!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else target[k] = resolveValue(v);
  }
  return target;
}
function autoId(){ return 'id' + Date.now().toString(36) + (G.seq++).toString(36); }
const lastSegment = path => path.split('/').pop();

/* ---------------- snapshots + live listeners ---------------- */
const META = { hasPendingWrites: false, fromCache: false };
function docSnap(path){
  const exists = G.docs.has(path);
  const data = exists ? clone(G.docs.get(path)) : undefined;
  return { id: lastSegment(path), ref: { type: 'doc', path, id: lastSegment(path) }, exists: () => exists, data: () => data, metadata: META };
}
function childDocs(colPath){
  const depth = colPath.split('/').length + 1;
  return [...G.docs.keys()].filter(p => p.startsWith(colPath + '/') && p.split('/').length === depth);
}
function matches(data, c){
  const v = getPath(data, c.field);
  switch(c.op){
    case '==': return v === c.value;
    case 'in': return c.value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(c.value);
    case 'array-contains-any': return Array.isArray(v) && v.some(x => c.value.includes(x));
    default: return true;
  }
}
function querySnap(q){
  let paths = childDocs(q.path);
  const cons = q.constraints || [];
  for(const c of cons) if(c.kind === 'where') paths = paths.filter(p => matches(G.docs.get(p), c));
  const order = cons.find(c => c.kind === 'orderBy');
  if(order){
    const key = p => { const v = getPath(G.docs.get(p), order.field); return v instanceof Timestamp ? v.toMillis() : v; };
    paths.sort((a, b) => (key(a) > key(b) ? 1 : -1) * (order.dir === 'desc' ? -1 : 1));
  }
  const lim = cons.find(c => c.kind === 'limit');
  if(lim) paths = paths.slice(0, lim.n);
  const docs = paths.map(docSnap);
  return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn), docChanges: () => [], metadata: META };
}
function snapFor(ref){ return ref.type === 'doc' ? docSnap(ref.path) : querySnap(ref); }
function notify(){
  for(const l of G.listeners) queueMicrotask(() => { try{ l.cb(snapFor(l.ref)); }catch(e){ console.error(e); } });
}

/* ---------------- app / analytics / app check / AI ---------------- */
export function initializeApp(options){ return { name: '[DEFAULT]', options }; }
export function getAnalytics(){ return {}; }
export function initializeAppCheck(){ return {}; }
export class ReCaptchaV3Provider { constructor(key){ this.key = key; } }
export function getAI(){ return {}; }
export class GoogleAIBackend {}
export function getGenerativeModel(){
  return { generateContent: async () => ({ response: { text: () => '[]' } }) };
}

/* ---------------- auth ---------------- */
function fireAuth(){ for(const cb of G.authCallbacks) setTimeout(() => cb(G.auth.currentUser), 0); }
export function getAuth(){ return G.auth; }
export function onAuthStateChanged(auth, cb){
  G.authCallbacks.add(cb);
  setTimeout(() => cb(G.auth.currentUser), 0);
  return () => G.authCallbacks.delete(cb);
}
export async function signInAnonymously(){
  G.auth.currentUser = { uid: 'test-user-1', isAnonymous: true, email: null, displayName: null, refreshToken: 'test-refresh-token' };
  fireAuth();
  return { user: G.auth.currentUser };
}
export async function signOut(){ G.auth.currentUser = null; fireAuth(); }
export class GoogleAuthProvider {}
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
const popupClosed = () => Promise.reject(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
export function signInWithPopup(){ return popupClosed(); }
export function linkWithPopup(){ return popupClosed(); }
export async function linkWithCredential(user, cred){
  Object.assign(user, { isAnonymous: false, email: cred.email });
  return { user };
}
export async function signInWithEmailAndPassword(auth, email){
  G.auth.currentUser = { uid: 'test-user-1', isAnonymous: false, email, displayName: null, refreshToken: 'test-refresh-token' };
  fireAuth();
  return { user: G.auth.currentUser };
}

/* ---------------- firestore ---------------- */
export function initializeFirestore(){ return { type: 'firestore' }; }
export function persistentLocalCache(){ return {}; }
export function persistentMultipleTabManager(){ return {}; }
export function deleteField(){ return DELETE; }
export function serverTimestamp(){ return SERVER_TS; }

export function collection(base, ...segments){
  const prefix = base && base.type === 'doc' ? base.path + '/' : '';
  return { type: 'collection', path: prefix + segments.join('/'), constraints: [] };
}
export function doc(base, ...segments){
  let path;
  if(base && base.type === 'collection') path = base.path + '/' + (segments.length ? segments.join('/') : autoId());
  else if(base && base.type === 'doc') path = base.path + '/' + segments.join('/');
  else path = segments.join('/');
  return { type: 'doc', path, id: lastSegment(path) };
}
export function where(field, op, value){ return { kind: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc'){ return { kind: 'orderBy', field, dir }; }
export function limit(n){ return { kind: 'limit', n }; }
export function query(col, ...constraints){ return { type: 'query', path: col.path, constraints }; }

export async function getDoc(ref){ return docSnap(ref.path); }
export const getDocFromServer = getDoc;
export async function getDocs(q){ return querySnap(q); }

function writeSet(ref, data, opts){
  if(opts && opts.merge){
    G.docs.set(ref.path, deepMerge(clone(G.docs.get(ref.path) || {}), data));
  } else {
    const fresh = {};
    for(const k of Object.keys(data)) if(data[k] !== DELETE) fresh[k] = resolveValue(data[k]);
    G.docs.set(ref.path, fresh);
  }
}
function writeUpdate(ref, data){
  if(!G.docs.has(ref.path)) throw Object.assign(new Error('No document to update: ' + ref.path), { code: 'not-found' });
  const cur = clone(G.docs.get(ref.path));
  for(const k of Object.keys(data)) setPath(cur, k, data[k]);
  G.docs.set(ref.path, cur);
}
export async function setDoc(ref, data, opts){ writeSet(ref, data, opts); notify(); }
export async function updateDoc(ref, data){ writeUpdate(ref, data); notify(); }
export async function deleteDoc(ref){ G.docs.delete(ref.path); notify(); }

export async function runTransaction(db, fn){
  const writes = [];
  const tx = {
    get: async ref => docSnap(ref.path),
    set: (ref, data, opts) => { writes.push(() => writeSet(ref, data, opts)); return tx; },
    update: (ref, data) => { writes.push(() => writeUpdate(ref, data)); return tx; },
    delete: ref => { writes.push(() => G.docs.delete(ref.path)); return tx; },
  };
  const result = await fn(tx);
  writes.forEach(w => w());
  notify();
  return result;
}

export function onSnapshot(ref, ...args){
  if(args[0] && typeof args[0] === 'object' && !(typeof args[0] === 'function')) args.shift();
  const [cb] = args;
  const entry = { ref, cb };
  G.listeners.add(entry);
  queueMicrotask(() => { if(G.listeners.has(entry)) cb(snapFor(ref)); });
  return () => G.listeners.delete(entry);
}
