// Smoke test for the REST API against the in-memory mock store: npm run test:api
process.env.TRIPLAN_MOCK = "1";
const { handleApi } = await import("../src/api.js");
const { store } = await import("../src/lib/firestore.js");
const { normalizeDay } = await import("../src/lib/trips.js");
// Seed one trip owned by the mock user.
const st = store();
const uid = await st.uid();
await st.write("trips/t1", {
  name: "בדיקה", startDate: "2026-05-01", currency: "ILS", secondaryCurrency: "", budget: "",
  dayHourOverrides: {}, days: [normalizeDay(), normalizeDay()], attractionIdeas: [], dayGroups: [], documents: [], archived: false,
  members: { [uid]: "owner" }, codes: {},
}, { mode: "create" });

async function call(method: string, path: string, body?: unknown) {
  const res = await handleApi(new Request("http://x/api/v1" + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } }));
  return { status: res.status, data: await res.json() as any };
}
const check = (ok: boolean, msg: string) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) process.exitCode = 1; };

const root = await call("GET", "");
check(root.status === 200 && Array.isArray(root.data.endpoints), "GET /api/v1 lists endpoints");
const trips = await call("GET", "/trips");
check(trips.status === 200 && trips.data.trips.length > 0, "GET /trips returns trips");
const id = trips.data.trips[0].id;
check((await call("GET", `/trips/${id}`)).status === 200, "GET /trips/{id}");
check((await call("GET", `/trips/${id}/budget`)).status === 200, "GET /trips/{id}/budget");
const add = await call("POST", `/trips/${id}/days/1/activities`, { title: "בדיקת API", time: "10:00" });
check(add.status === 201 && add.data.activity.id, "POST activity");
const aid = add.data.activity.id;
check((await call("PATCH", `/trips/${id}/activities/${aid}`, { notes: "עודכן" })).data.activity.notes === "עודכן", "PATCH activity");
check((await call("DELETE", `/trips/${id}/activities/${aid}`)).status === 200, "DELETE activity");
const idea = await call("POST", `/trips/${id}/ideas`, { nameHe: "רעיון בדיקה" });
check(idea.status === 201, "POST idea");
check((await call("DELETE", `/trips/${id}/ideas/${idea.data.idea.id}`)).status === 200, "DELETE idea");
check((await call("POST", `/trips/${id}/ideas`, {})).status === 400, "POST idea without a name gives 400");
check((await call("GET", "/nope")).status === 404, "unknown path gives 404");
