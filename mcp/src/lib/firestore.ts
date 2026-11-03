// Firestore access for the triplan connector.
// Real mode: signs in as a dedicated Firebase user (Identity Toolkit REST) and talks to the Firestore
// REST API, so firestore.rules stay fully enforced (the connector can only do what that user may do).
// Mock mode (TRIPLAN_MOCK=1): in-memory store with the same interface, for local tests.
import { UpstreamError } from "./http.js";

export type Doc = { id: string; data: Record<string, any>; updateTime?: string };

export interface WriteOpts {
  /** Only these top-level fields are written (merge). Omit to replace the whole document. */
  mask?: string[];
  /** Top-level fields set to the server time. */
  serverTime?: string[];
  /** Fail unless the document still has this updateTime (optimistic concurrency). */
  ifUpdateTime?: string;
  /** "create" fails if the document exists. */
  mode?: "create" | "update";
}

export interface Store {
  uid(): Promise<string>;
  get(path: string): Promise<Doc | null>;
  list(collectionPath: string): Promise<Doc[]>;
  /** Trips where the signed-in user is a member. */
  myTrips(): Promise<Doc[]>;
  write(path: string, data: Record<string, any>, opts?: WriteOpts): Promise<void>;
  remove(path: string): Promise<void>;
  newId(): string;
}

/** Top-level field of a mask path ("members.`uid`" -> "members"). */
const topOf = (p: string) => p.split(".")[0];

export class ConflictError extends UpstreamError {}

// ---------------------------------------------------------------- value codec
export function toValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
export function toFields(o: Record<string, any>): Record<string, any> {
  const f: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = toValue(v);
  return f;
}
export function fromValue(v: any): any {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields ?? {});
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
export function fromFields(f: Record<string, any>): Record<string, any> {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(f)) o[k] = fromValue(v);
  return o;
}

// ---------------------------------------------------------------- real (REST) store
interface Session {
  idToken: string;
  refreshToken: string;
  uid: string;
  expires: number;
}
let session: Session | null = null;
let signingIn: Promise<Session> | null = null;

// FIREBASE_EMULATOR=1 points every URL at the local Emulator Suite (auth 9099, firestore 8080) and needs no API key.
const EMU = process.env.FIREBASE_EMULATOR === "1";
const AUTH_ROOT = EMU ? "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1" : "https://identitytoolkit.googleapis.com/v1";
const TOKEN_URL = EMU ? "http://127.0.0.1:9099/securetoken.googleapis.com/v1/token" : "https://securetoken.googleapis.com/v1/token";
const FS_ROOT = EMU ? "http://127.0.0.1:8080/v1" : "https://firestore.googleapis.com/v1";

function env(name: string): string {
  if (EMU && name === "FIREBASE_API_KEY") return "fake-emulator-key";
  const v = process.env[name];
  if (!v) throw new UpstreamError(`Server is not configured: environment variable ${name} is missing.`, "config");
  return v;
}

async function authFetch(url: string, body: unknown, form = false): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? String(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new UpstreamError(`Firebase sign-in failed: ${msg}`, "firebase-auth", res.status);
  }
  return json;
}

async function getSession(): Promise<Session> {
  if (session && session.expires > Date.now() + 60_000) return session;
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const key = env("FIREBASE_API_KEY");
    if (session?.refreshToken) {
      try {
        const j = await authFetch(
          `${TOKEN_URL}?key=${key}`,
          `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
          true,
        );
        session = { idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id, expires: Date.now() + Number(j.expires_in) * 1000 };
        return session;
      } catch {
        /* fall through to a full sign-in */
      }
    }
    const j = await authFetch(`${AUTH_ROOT}/accounts:signInWithPassword?key=${key}`, {
      email: env("TRIPLAN_EMAIL"),
      password: env("TRIPLAN_PASSWORD"),
      returnSecureToken: true,
    });
    session = { idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId, expires: Date.now() + Number(j.expiresIn) * 1000 };
    return session;
  })().finally(() => (signingIn = null));
  return signingIn;
}

const base = () => `${FS_ROOT}/projects/${env("FIREBASE_PROJECT_ID")}/databases/(default)/documents`;
const docName = (path: string) => `projects/${env("FIREBASE_PROJECT_ID")}/databases/(default)/documents/${path}`;

// App Check: when enforced, Firestore needs an App Check token. A server cannot run reCAPTCHA, so it uses a
// *debug token* (registered in Firebase console > App Check > Apps > Manage debug tokens) exchanged for a real token.
// Env: APPCHECK_DEBUG_TOKEN + FIREBASE_APP_ID (the web app id, e.g. 1:123:web:abc). Both optional.
let appCheck: { token: string; expires: number } | null = null;
async function getAppCheck(): Promise<string | null> {
  const dbg = process.env.APPCHECK_DEBUG_TOKEN;
  const appId = process.env.FIREBASE_APP_ID;
  if (EMU || !dbg || !appId) return null;
  if (appCheck && appCheck.expires > Date.now() + 60_000) return appCheck.token;
  const res = await fetch(
    `https://firebaseappcheck.googleapis.com/v1/projects/${env("FIREBASE_PROJECT_ID")}/apps/${appId}:exchangeDebugToken?key=${env("FIREBASE_API_KEY")}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ debug_token: dbg }), signal: AbortSignal.timeout(10000) },
  );
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new UpstreamError(`App Check token exchange failed: ${j?.error?.message ?? res.status}`, "appcheck", res.status);
  appCheck = { token: j.token, expires: Date.now() + (parseInt(String(j.ttl ?? "3600s"), 10) || 3600) * 1000 };
  return appCheck.token;
}

async function fs(method: string, url: string, body?: unknown): Promise<any> {
  const s = await getSession();
  const ac = await getAppCheck();
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${s.idToken}`, "content-type": "application/json", ...(ac ? { "x-firebase-appcheck": ac } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = json?.error?.status ?? "";
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 409 || status === "ABORTED" || status === "FAILED_PRECONDITION" || status === "ALREADY_EXISTS")
      throw new ConflictError(`Firestore conflict: ${msg}`, "firestore", res.status);
    if (res.status === 403)
      throw new UpstreamError(
        `Firestore denied the request (${msg}). The connector user is probably not a member of this trip with a sufficient role, or Firebase App Check is enforced for Firestore.`,
        "firestore",
        403,
      );
    throw new UpstreamError(`Firestore error: ${msg}`, "firestore", res.status);
  }
  return json;
}

const idOf = (name: string) => name.split("/").pop() as string;
const toDoc = (d: any): Doc => ({ id: idOf(d.name), data: fromFields(d.fields ?? {}), updateTime: d.updateTime });

export const restStore: Store = {
  async uid() {
    return (await getSession()).uid;
  },
  async get(path) {
    const d = await fs("GET", `${base()}/${path}`);
    return d ? toDoc(d) : null;
  },
  async list(collectionPath) {
    const out: Doc[] = [];
    let token = "";
    do {
      const j = await fs("GET", `${base()}/${collectionPath}?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
      for (const d of j?.documents ?? []) out.push(toDoc(d));
      token = j?.nextPageToken ?? "";
    } while (token);
    return out;
  },
  async myTrips() {
    const uid = await this.uid();
    const j = await fs("POST", `${base()}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: "trips" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "members.`" + uid + "`" },
            op: "IN",
            value: { arrayValue: { values: ["owner", "editor", "viewer"].map((r) => ({ stringValue: r })) } },
          },
        },
      },
    });
    return (j ?? []).filter((r: any) => r.document).map((r: any) => toDoc(r.document));
  },
  async write(path, data, opts = {}) {
    const fields = opts.mask ? Object.fromEntries([...new Set(opts.mask.map(topOf))].filter((k) => k in data).map((k) => [k, data[k]])) : data;
    const write: any = { update: { name: docName(path), fields: toFields(fields) } };
    if (opts.mask) write.updateMask = { fieldPaths: opts.mask };
    if (opts.serverTime?.length)
      write.updateTransforms = opts.serverTime.map((f) => ({ fieldPath: f, setToServerValue: "REQUEST_TIME" }));
    if (opts.ifUpdateTime) write.currentDocument = { updateTime: opts.ifUpdateTime };
    else if (opts.mode === "create") write.currentDocument = { exists: false };
    else if (opts.mode === "update") write.currentDocument = { exists: true };
    await fs("POST", `${base()}:commit`, { writes: [write] });
  },
  async remove(path) {
    await fs("POST", `${base()}:commit`, { writes: [{ delete: docName(path) }] });
  },
  newId() {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from({ length: 20 }, () => c[Math.floor(Math.random() * c.length)]).join("");
  },
};

// ---------------------------------------------------------------- mock store (tests)
const mem = new Map<string, { data: Record<string, any>; v: number }>();
const MOCK_UID = "mock-user";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const mockStore: Store = {
  async uid() {
    return MOCK_UID;
  },
  async get(path) {
    const e = mem.get(path);
    return e ? { id: path.split("/").pop()!, data: clone(e.data), updateTime: String(e.v) } : null;
  },
  async list(collectionPath) {
    const re = new RegExp("^" + collectionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/[^/]+$");
    return [...mem.entries()].filter(([p]) => re.test(p)).map(([p, e]) => ({ id: p.split("/").pop()!, data: clone(e.data), updateTime: String(e.v) }));
  },
  async myTrips() {
    return (await this.list("trips")).filter((d) => d.data.members?.[MOCK_UID]);
  },
  async write(path, data, opts = {}) {
    const cur = mem.get(path);
    if (opts.mode === "create" && cur) throw new ConflictError("Document already exists.", "mock", 409);
    if (opts.mode === "update" && !cur) throw new UpstreamError("Document not found.", "mock", 404);
    if (opts.ifUpdateTime && String(cur?.v) !== opts.ifUpdateTime) throw new ConflictError("Document changed.", "mock", 409);
    let next: Record<string, any>;
    if (opts.mask && cur) {
      next = clone(cur.data);
      for (const k of opts.mask) {
        const top = topOf(k);
        if (!(top in data)) continue;
        if (k.includes(".")) {
          const sub = k.slice(top.length + 1).replace(/`/g, "");
          next[top] = { ...(next[top] ?? {}), [sub]: clone(data[top][sub]) };
        } else next[k] = clone(data[k]);
      }
    } else next = clone(opts.mask ? Object.fromEntries([...new Set(opts.mask.map(topOf))].filter((k) => k in data).map((k) => [k, data[k]])) : data);
    for (const f of opts.serverTime ?? []) next[f] = Date.now();
    mem.set(path, { data: next, v: (cur?.v ?? 0) + 1 });
  },
  async remove(path) {
    mem.delete(path);
  },
  newId() {
    return "m" + Math.random().toString(36).slice(2, 12);
  },
};

export const store = (): Store => (process.env.TRIPLAN_MOCK === "1" ? mockStore : restStore);
