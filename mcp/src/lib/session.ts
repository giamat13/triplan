// Per-request sign-in from the personal link. Shared design with the triplan connector: copy this file as is.
// The link carries the user's Firebase refresh token (`?key=...`). Each request trades it for a short-lived
// ID token, so Firestore sees the real user and firestore.rules stay the security boundary. Nothing is stored.
import { AsyncLocalStorage } from "node:async_hooks";

export type Session = { idToken: string; uid: string; email: string; expires: number };

const EMULATOR = process.env.FIREBASE_EMULATOR === "1";
const TOKEN_URL = EMULATOR
  ? "http://127.0.0.1:9099/securetoken.googleapis.com/v1/token"
  : "https://securetoken.googleapis.com/v1/token";

const als = new AsyncLocalStorage<{ key: string }>();
const cache = new Map<string, Session>(); // best effort, per isolate; entries expire with the ID token

/** Runs `fn` with the personal key of this request in scope. */
export const withKey = <T>(key: string, fn: () => Promise<T>): Promise<T> => als.run({ key }, fn);
export const currentKey = (): string => als.getStore()?.key ?? "";

function payload(jwt: string): Record<string, unknown> {
  try {
    const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

/** Trades a refresh token for an ID token. Throws a readable error when the link is no longer valid. */
export async function sessionFromRefreshToken(refreshToken: string, apiKey: string): Promise<Session> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expires > Date.now() + 60_000) return hit;
  let res: Response;
  try {
    res = await fetch(`${TOKEN_URL}?key=${EMULATOR ? "fake" : encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    throw new Error(`Firebase is unreachable (${e instanceof Error ? e.message : String(e)}).`);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      "Your Claude link is no longer valid (you signed out everywhere, changed your password, or the link is wrong). Open the app and create a new link.",
    );
  const idToken: string = body.id_token ?? body.idToken;
  const claims = payload(idToken);
  const session: Session = {
    idToken,
    uid: String(body.user_id ?? claims.user_id ?? claims.sub ?? ""),
    email: String(claims.email ?? ""),
    expires: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  };
  if (cache.size > 200) cache.clear();
  cache.set(refreshToken, session);
  return session;
}
