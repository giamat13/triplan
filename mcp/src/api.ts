// General REST API (JSON) next to the MCP connector, for other apps and scripts.
// Same personal key as the Claude link: `Authorization: Bearer <key>` or `?key=<key>`.
// Every call runs as that signed-in user against Firestore, so firestore.rules stay the security boundary.
import { UpstreamError } from "./lib/http.js";
import { withKey } from "./lib/session.js";
import { store } from "./lib/firestore.js";
import {
  budgetOf,
  dayDate,
  findActivity,
  findDay,
  findIdea,
  listTrips,
  loadTrip,
  mutateTrip,
  normalizeActivity,
  normalizeIdea,
  type Trip,
} from "./lib/trips.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};
const MAX_BODY = 256 * 1024;
const BASE = "/api/v1";

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function bodyOf(request: Request): Promise<Record<string, any>> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Payload too large (max 256 KB).");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "The body must be a JSON object.");
  }
}

/** Copies only the allowed keys (and only strings, numbers, booleans) from the request body. */
function pick(body: Record<string, any>, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    const v = body[k];
    if (v === undefined) continue;
    if (typeof v === "string" && v.length > 2000) throw new HttpError(400, `"${k}" is too long (max 2000).`);
    if (["string", "number", "boolean"].includes(typeof v) || v === null) out[k] = v;
    else throw new HttpError(400, `"${k}" must be text, a number or true/false.`);
  }
  return out;
}

const ACTIVITY_KEYS = ["time", "title", "category", "cuisine", "transport", "cost", "link", "notes", "duration", "priority", "hours", "booking", "equipment", "partySize", "confirmation", "mapQuery", "rating"] as const;
const IDEA_KEYS = ["nameHe", "nameEn", "duration", "priority", "hours", "price", "booking", "equipment", "notes", "link", "cuisine", "category", "partySize", "mapQuery", "rating", "excluded"] as const;

const tripSummary = (id: string, trip: Trip, role: string) => ({
  id, name: trip.name, startDate: trip.startDate, currency: trip.currency, role, archived: trip.archived,
  days: trip.days.length, ideas: trip.attractionIdeas.length, documents: trip.documents.length,
});
const dayView = (trip: Trip, i: number) => ({ number: i + 1, date: dayDate(trip.startDate, i), ...trip.days[i] });

const isBlank = (a: ReturnType<typeof normalizeActivity>) => !a.title && !a.time && !a.cost && !a.notes;

async function route(request: Request, path: string): Promise<Response> {
  const method = request.method;
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

  if (!parts.length) {
    return json({
      name: "triplan API", version: 1, auth: "Authorization: Bearer <your personal key>",
      endpoints: [
        "GET    /trips", "GET    /trips/{tripId}", "GET    /trips/{tripId}/budget",
        "GET    /trips/{tripId}/days/{dayNumber}", "POST   /trips/{tripId}/days/{dayNumber}/activities",
        "PATCH  /trips/{tripId}/activities/{activityId}", "DELETE /trips/{tripId}/activities/{activityId}",
        "GET    /trips/{tripId}/ideas", "POST   /trips/{tripId}/ideas",
        "PATCH  /trips/{tripId}/ideas/{ideaId}", "DELETE /trips/{tripId}/ideas/{ideaId}",
      ],
    });
  }
  if (parts[0] !== "trips") throw new HttpError(404, "Unknown path. GET /api/v1 lists the endpoints.");

  if (parts.length === 1) {
    if (method !== "GET") throw new HttpError(405, "Use GET.");
    return json({ trips: (await listTrips()).map((t) => tripSummary(t.id, t.trip, t.role)) });
  }

  const tripId = parts[1];
  const sub = parts[2];

  if (!sub) {
    if (method !== "GET") throw new HttpError(405, "Use GET.");
    const l = await loadTrip(tripId);
    const { members, codes, ...rest } = l.trip as Trip & Record<string, any>;
    return json({ ...tripSummary(l.id, l.trip, l.role), trip: rest });
  }

  if (sub === "budget") {
    if (method !== "GET") throw new HttpError(405, "Use GET.");
    return json(budgetOf((await loadTrip(tripId)).trip));
  }

  if (sub === "days") {
    const n = Number(parts[3]);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "dayNumber must be a whole number, starting at 1.");
    if (parts[4] === undefined) {
      if (method !== "GET") throw new HttpError(405, "Use GET.");
      const { trip } = await loadTrip(tripId);
      const { index } = findDay(trip, { dayNumber: n });
      return json(dayView(trip, index));
    }
    if (parts[4] === "activities" && method === "POST") {
      const input = pick(await bodyOf(request), ACTIVITY_KEYS);
      if (!input.title) throw new HttpError(400, '"title" is required.');
      const { trip, result } = await mutateTrip(tripId, ["days"], (t) => {
        const { day, index } = findDay(t, { dayNumber: n });
        const act = normalizeActivity(input);
        if (day.activities.length === 1 && isBlank(day.activities[0])) day.activities[0] = act; else day.activities.push(act);
        return { index, activity: act };
      });
      return json({ day: dayView(trip, result.index), activity: result.activity }, 201);
    }
    throw new HttpError(404, "Unknown path. GET /api/v1 lists the endpoints.");
  }

  if (sub === "activities" && parts[3]) {
    const id = parts[3];
    if (method === "PATCH") {
      const input = pick(await bodyOf(request), ACTIVITY_KEYS);
      const { result } = await mutateTrip(tripId, ["days"], (t) => {
        const f = findActivity(t, id);
        Object.assign(f.activity, normalizeActivity({ ...f.activity, ...input, id }));
        return f.activity;
      });
      return json({ activity: result });
    }
    if (method === "DELETE") {
      await mutateTrip(tripId, ["days", "attractionIdeas"], (t) => {
        const f = findActivity(t, id);
        f.day.activities.splice(f.index, 1);
        if (!f.day.activities.length) f.day.activities.push(normalizeActivity());
        const idea = t.attractionIdeas.find((i) => i.id === f.activity.sourceIdeaId);
        if (idea) idea.scheduled = false;
      });
      return json({ deleted: id });
    }
    throw new HttpError(405, "Use PATCH or DELETE.");
  }

  if (sub === "ideas") {
    const id = parts[3];
    if (!id) {
      if (method === "GET") return json({ ideas: (await loadTrip(tripId)).trip.attractionIdeas });
      if (method === "POST") {
        const input = pick(await bodyOf(request), IDEA_KEYS);
        if (!input.nameHe && !input.nameEn) throw new HttpError(400, 'Give "nameHe" or "nameEn".');
        const uid = await store().uid();
        const { result } = await mutateTrip(tripId, ["attractionIdeas"], (t) => {
          const idea = normalizeIdea({ ...input, createdAt: Date.now(), createdBy: uid });
          t.attractionIdeas.push(idea);
          return idea;
        });
        return json({ idea: result }, 201);
      }
      throw new HttpError(405, "Use GET or POST.");
    }
    if (method === "PATCH") {
      const input = pick(await bodyOf(request), IDEA_KEYS);
      const { result } = await mutateTrip(tripId, ["attractionIdeas"], (t) => {
        const idea = findIdea(t, id);
        Object.assign(idea, normalizeIdea({ ...idea, ...input, id }));
        return idea;
      });
      return json({ idea: result });
    }
    if (method === "DELETE") {
      await mutateTrip(tripId, ["attractionIdeas", "dayGroups"], (t) => {
        findIdea(t, id);
        t.attractionIdeas = t.attractionIdeas.filter((i) => i.id !== id);
        t.dayGroups.forEach((g) => { g.ideaIds = g.ideaIds.filter((x: string) => x !== id); });
      });
      return json({ deleted: id });
    }
    throw new HttpError(405, "Use PATCH or DELETE.");
  }

  throw new HttpError(404, "Unknown path. GET /api/v1 lists the endpoints.");
}

export async function handleApi(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const key = (bearer ? bearer[1] : url.searchParams.get("key") ?? "").trim();
  // The key is the user's own refresh token from the app's "Connect Claude" button. Nothing is stored here.
  const mock = process.env.TRIPLAN_MOCK === "1";
  if (!mock && !/^[A-Za-z0-9_.-]{40,600}$/.test(key)) {
    return json({ error: "Missing or invalid key. Send your personal key as 'Authorization: Bearer <key>'." }, 401);
  }
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
  try {
    const run = () => route(request, path);
    return await (mock ? run() : withKey(key, run));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof UpstreamError) return json({ error: e.message }, (e as any).status ?? 502);
    console.error(e);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}
