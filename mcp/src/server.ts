import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UpstreamError } from "./lib/http.js";
import { ConflictError, store } from "./lib/firestore.js";
import {
  CATEGORY_ICON, DOC_ICON, type Trip,
  budgetOf, dayLabel, findActivity, findDay, findIdea, loadTrip, listTrips, money, mutateTrip,
  normalizeActivity, normalizeDay, normalizeDocument, normalizeGroup, normalizeIdea, normalizePackingItem, normalizeVideo,
  requireOwner, resolveTripId, sym,
} from "./lib/trips.js";
import { VIEW_CSP, VIEW_HTML, VIEW_MIME, VIEW_URI } from "./view.js";

const READ = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false } as const;

type Out = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const card = (t: string, data: Record<string, unknown>): Out => ({ content: [{ type: "text", text: t }], structuredContent: data });
const textOnly = (t: string): Out => ({ content: [{ type: "text", text: t }], structuredContent: { kind: "text", text: t } });
const fail = (t: string): Out => ({ content: [{ type: "text", text: t }], isError: true });
const UI_META = { ui: { resourceUri: VIEW_URI }, "ui/resourceUri": VIEW_URI };

function safe<A>(fn: (a: A) => Promise<Out>) {
  return async (a: A): Promise<Out> => {
    try {
      return await fn(a);
    } catch (e) {
      if (e instanceof ConflictError) return fail("⚠️ The trip was changed by someone else at the same moment. Please try again.");
      if (e instanceof UpstreamError) return fail(`⚠️ ${e.message}`);
      return fail(`⚠️ Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

// ------------------------------------------------------------------ shared schemas
const tripId = z.string().trim().min(1).max(60).optional().describe("Trip id (from list_trips). Optional when the user has exactly one active trip.");
const dayRef = {
  dayNumber: z.number().int().min(1).max(400).optional().describe("1-based day number, e.g. 3 for the third day."),
  dayId: z.string().max(80).optional().describe("Day id (alternative to dayNumber)."),
};
const str = (n = 500) => z.string().max(n);
const amount = z.union([z.string().max(30), z.number()]).transform((v) => String(v)).describe("Amount as a number, e.g. 45.5");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const time = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "use HH:MM");
const currency = z.string().regex(/^[A-Z]{3}$/, "3-letter code, e.g. ILS").describe("Currency code, e.g. ILS, USD, EUR.");
const priority = z.string().max(20).describe("Priority as used in the app, e.g. 'must', 'high', 'medium', 'low' or free text.");

const activityFields = {
  time: time.optional().describe("Start time HH:MM."),
  category: z.enum(["sight", "food", "transport"]).optional().describe("sight = attraction/ticket, food = restaurant, transport = transit."),
  cost: amount.optional().describe("Cost in the day's currency."),
  notes: str(2000).optional(), link: str(500).optional(), duration: str(40).optional().describe("e.g. '2h' or '90m'."),
  hours: str(100).optional().describe("Opening hours, e.g. '09:00-18:00'."), priority: priority.optional(),
  booking: z.boolean().optional().describe("Needs advance booking."), equipment: str(200).optional(), cuisine: str(100).optional(),
  transport: str(100).optional(), partySize: str(20).optional(), confirmation: str(100).optional(), mapQuery: str(200).optional().describe("Text to search on the map."),
  rating: str(10).optional(),
};
const activityKeys = [...Object.keys(activityFields), "title"];
const ideaFields = {
  nameHe: str(200).optional().describe("Hebrew name."), nameEn: str(200).optional().describe("English name."),
  category: z.enum(["sight", "food"]).optional(), duration: str(40).optional(), hours: str(100).optional(), priority: priority.optional(),
  price: amount.optional(), booking: z.boolean().optional(), equipment: str(200).optional(), notes: str(2000).optional(), link: str(500).optional(),
  cuisine: str(100).optional(), partySize: str(20).optional(), mapQuery: str(200).optional(), rating: str(10).optional(),
  excluded: z.boolean().optional().describe("Hide from planning without deleting."),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
};
const documentFields = {
  type: z.enum(["flight", "hotel", "car", "general"]).optional(), title: str(200).optional(),
  flightNumber: str(30).optional(), depTime: str(40).optional(), arrTime: str(40).optional(), gate: str(20).optional(),
  address: str(300).optional(), checkIn: str(40).optional(), checkOut: str(40).optional(), company: str(100).optional(),
  pickupInfo: str(300).optional(), returnInfo: str(300).optional(), confirmationNumber: str(100).optional(), link: str(500).optional(), notes: str(3000).optional(),
};
const hotelFields = {
  hotelName: str(200).optional(), hotelLink: str(500).optional(), hotelCost: amount.optional(), hotelNotes: str(1000).optional(),
  breakfast: z.boolean().optional().describe("Breakfast included."), checkIn: date.or(z.literal("")).optional(), checkOut: date.or(z.literal("")).optional(),
};

/** Copy only the keys the caller actually passed. */
function patch(target: any, src: any, keys: string[]) {
  for (const k of keys) if (src[k] !== undefined) target[k] = src[k];
  return target;
}

// ------------------------------------------------------------------ page builders
type Item = Record<string, unknown>;
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const roleHe = { owner: "בעלים", editor: "עורך", viewer: "צופה" } as const;
type Act = ReturnType<typeof normalizeActivity>;
const isBlank = (a: Act) => !a.title && !a.time && !a.notes && !a.cost;
const byTime = (a: { time: string }, b: { time: string }) => (a.time || "99:99").localeCompare(b.time || "99:99");
const httpUrl = (u: string) => (/^https?:\/\//.test(u) ? u : undefined);

function activityItem(a: Act, cur: string): Item {
  const bits = [a.cost && `${sym(cur)}${a.cost}`, a.duration, a.hours, a.cuisine, a.notes].filter(Boolean);
  return { icon: CATEGORY_ICON[a.category], time: a.time, title: a.title || "(ללא שם)", sub: bits.join(" · "), badge: a.booking ? "דורש הזמנה" : a.confirmation ? "מאושר" : "", url: httpUrl(a.link) };
}

function dayPage(l: { id: string; trip: Trip }, index: number): Record<string, unknown> {
  const { trip, id } = l;
  const d = trip.days[index];
  const cur = d.currency || trip.currency;
  const acts = d.activities.filter((a) => !isBlank(a)).sort(byTime);
  const h = d.hotel;
  const docs = trip.documents.filter((x) => x.dayId === d.id);
  const nav: Item[] = [];
  if (index > 0) nav.push({ icon: "⬅️", title: dayLabel(trip, index - 1), call: call("get_day", { tripId: id, dayNumber: index }) });
  if (index < trip.days.length - 1) nav.push({ icon: "➡️", title: dayLabel(trip, index + 1), call: call("get_day", { tripId: id, dayNumber: index + 2 }) });
  return {
    kind: "page", title: dayLabel(trip, index), sub: trip.name,
    chips: [`${acts.length} פעילויות`, d.currency ? `מטבע: ${d.currency}` : "", h.name ? "🏨 " + h.name : ""].filter(Boolean),
    sections: [
      { heading: "לו״ז", items: acts.map((a) => activityItem(a, cur)), empty: "אין פעילויות ביום הזה." },
      h.name ? { heading: "מלון", items: [{ icon: "🏨", title: h.name, sub: [h.cost && `${sym(cur)}${h.cost}`, h.breakfast && "ארוחת בוקר כלולה", h.checkIn && `צ׳ק-אין ${h.checkIn}`, h.checkOut && `צ׳ק-אאוט ${h.checkOut}`, h.notes].filter(Boolean).join(" · "), url: httpUrl(h.link) }] } : null,
      docs.length ? { heading: "מסמכים", items: docs.map((x) => ({ icon: DOC_ICON[x.type], title: x.title || "(ללא כותרת)", sub: [x.flightNumber, x.confirmationNumber].filter(Boolean).join(" · ") })) } : null,
      nav.length ? { heading: "ניווט", items: nav } : null,
    ].filter(Boolean),
  };
}

function tripPage(l: { id: string; trip: Trip; role: keyof typeof roleHe }): Record<string, unknown> {
  const { trip, id } = l;
  const b = budgetOf(trip);
  const open = trip.attractionIdeas.filter((i) => !i.scheduled && !i.excluded).length;
  return {
    kind: "page", title: `🧳 ${trip.name || "טיול ללא שם"}`,
    sub: [trip.startDate && `יציאה ${trip.startDate}`, `מטבע ${trip.currency}${trip.secondaryCurrency ? ` / ${trip.secondaryCurrency}` : ""}`, trip.archived && "בארכיון"].filter(Boolean).join(" · "),
    chips: [`${trip.days.length} ימים`, `${open} רעיונות פתוחים`, `${trip.documents.length} מסמכים`, roleHe[l.role], b.cap ? `תקציב ${money(b.total, b.primary)} מתוך ${money(b.cap, b.primary)}` : `הוצאה מתוכננת ${money(b.total, b.primary)}`],
    sections: [
      {
        heading: "ימים",
        items: trip.days.map((d, i) => ({
          icon: "📅", title: dayLabel(trip, i),
          sub: d.activities.filter((a) => !isBlank(a)).slice(0, 3).map((a) => a.title).join(" · "),
          badge: String(d.activities.filter((a) => !isBlank(a)).length), call: call("get_day", { tripId: id, dayNumber: i + 1 }),
        })),
        empty: "אין ימים בטיול.",
      },
      {
        heading: "עוד",
        items: [
          { icon: "💡", title: "רעיונות לאטרקציות", badge: String(open), call: call("list_ideas", { tripId: id }) },
          { icon: "📄", title: "מסמכים והזמנות", badge: String(trip.documents.length), call: call("list_documents", { tripId: id }) },
          { icon: "💰", title: "תקציב", call: call("get_budget", { tripId: id }) },
          { icon: "🎒", title: "רשימת אריזה (של משתמש המחבר)", call: call("get_packing_list", { tripId: id }) },
          { icon: "👥", title: "שיתוף וחברים", call: call("get_sharing", { tripId: id }) },
        ],
      },
    ],
  };
}

const ideaItem = (i: ReturnType<typeof normalizeIdea>): Item => ({
  icon: i.category === "food" ? "🍴" : "🎫", title: i.nameHe || i.nameEn || "(ללא שם)",
  sub: [i.nameHe && i.nameEn, i.duration, i.price && `מחיר ${i.price}`, i.priority && `עדיפות ${i.priority}`, i.notes].filter(Boolean).join(" · "),
  badge: i.scheduled ? "שובץ" : i.excluded ? "מוסתר" : i.booking ? "הזמנה" : "", url: httpUrl(i.link),
});
const docItem = (d: ReturnType<typeof normalizeDocument>): Item => ({
  icon: DOC_ICON[d.type], title: d.title || "(ללא כותרת)", badge: d.confirmationNumber || "",
  sub: [d.flightNumber && `טיסה ${d.flightNumber}`, d.depTime && `המראה ${d.depTime}`, d.arrTime && `נחיתה ${d.arrTime}`, d.address, d.checkIn && `צ׳ק-אין ${d.checkIn}`, d.checkOut && `צ׳ק-אאוט ${d.checkOut}`, d.company, d.notes].filter(Boolean).join(" · "),
  url: httpUrl(d.link),
});

const summary = (trip: Trip) => `${trip.name || "unnamed"}: ${trip.days.length} days, ${trip.attractionIdeas.length} ideas, ${trip.documents.length} documents`;
const code8 = () => Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

// ------------------------------------------------------------------ packing list (private per-user doc)
type PItem = ReturnType<typeof normalizePackingItem>;
type PVideo = ReturnType<typeof normalizeVideo>;
async function mutatePacking<R>(id: string, fn: (items: PItem[], videos: PVideo[]) => R) {
  const st = store();
  const { uid } = await loadTrip(id);
  const path = `trips/${id}/packingLists/${uid}`;
  for (let attempt = 0; ; attempt++) {
    const doc = await st.get(path);
    const items: PItem[] = (Array.isArray(doc?.data.items) ? doc!.data.items : []).map(normalizePackingItem);
    const videos: PVideo[] = (Array.isArray(doc?.data.videos) ? doc!.data.videos : []).map(normalizeVideo);
    const result = fn(items, videos);
    try {
      await st.write(path, { items, videos }, { serverTime: ["updatedAt"], ifUpdateTime: doc?.updateTime, mode: doc ? undefined : "create" });
      return { items, videos, result };
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) continue;
      throw e;
    }
  }
}
async function readPacking(id: string) {
  const { uid } = await loadTrip(id);
  const doc = await store().get(`trips/${id}/packingLists/${uid}`);
  return {
    items: (Array.isArray(doc?.data.items) ? doc!.data.items : []).map(normalizePackingItem) as PItem[],
    videos: (Array.isArray(doc?.data.videos) ? doc!.data.videos : []).map(normalizeVideo) as PVideo[],
  };
}
function packingPage(id: string, items: PItem[], videos: PVideo[]): Record<string, unknown> {
  const done = items.filter((i) => i.checked).length;
  return {
    kind: "page", title: "🎒 רשימת אריזה", sub: "הרשימה הפרטית של משתמש המחבר בטיול הזה", chips: [`${done}/${items.length} נארזו`],
    sections: [
      { heading: "פריטים", items: items.map((i) => ({ check: i.checked, title: i.text, sub: i.dueDaysBefore ? `${i.dueDaysBefore} ימים לפני הטיסה` : "", call: call("update_packing_item", { tripId: id, itemId: i.id, checked: !i.checked }) })), empty: "הרשימה ריקה." },
      videos.length ? { heading: "סרטונים להורדה לפני הטיסה", items: videos.map((v) => ({ icon: v.downloaded ? "✅" : "⬇️", title: v.title || v.url, url: httpUrl(v.url) })) } : null,
    ].filter(Boolean),
  };
}

// ------------------------------------------------------------------ server
export function createServer(): McpServer {
  const server = new McpServer({ name: "triplan", title: "Triplan – תכנון טיולים", version: "1.0.0" } as any);

  server.registerResource("card", VIEW_URI, { title: "Triplan card", description: "Visual cards for trip data.", mimeType: VIEW_MIME }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: VIEW_HTML, _meta: { ui: { csp: VIEW_CSP, prefersBorder: false } } }],
  }));

  type Def = { title: string; description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations: typeof READ | typeof WRITE | typeof DELETE };
  const tool = (name: string, def: Def, handler: (a: any) => Promise<Out>) =>
    server.registerTool(name, { title: def.title, description: def.description, inputSchema: def.inputSchema, annotations: { title: def.title, ...def.annotations }, _meta: UI_META } as any, safe(handler) as any);

  // ================================================================ READ
  tool("list_trips", { title: "🧳 Trips", annotations: READ, inputSchema: { includeArchived: z.boolean().default(false).describe("Also list archived trips.") },
    description: "Lists the trips the connector user belongs to (id, name, start date, days, role). Start here to get a tripId." },
    async ({ includeArchived }) => {
      const all = (await listTrips()).filter((t) => includeArchived || !t.trip.archived);
      return card(all.length ? all.map((t) => `${t.id} | ${t.trip.name || "unnamed"} | ${t.trip.startDate || "no date"} | ${t.trip.days.length} days | ${t.role}`).join("\n") : "No trips yet. Create one with create_trip.", {
        kind: "page", title: "🧳 הטיולים שלי", sub: `${all.length} טיולים`,
        sections: [{ items: all.map((t) => ({ icon: t.trip.archived ? "🗄️" : "🧳", title: t.trip.name || "טיול ללא שם", sub: [t.trip.startDate, `${t.trip.days.length} ימים`].filter(Boolean).join(" · "), badge: roleHe[t.role], call: call("get_trip", { tripId: t.id }) })), empty: "אין טיולים עדיין." }],
      });
    });

  tool("get_trip", { title: "🗺️ Trip overview", annotations: READ, inputSchema: { tripId },
    description: "Overview of one trip: settings, days with their first activities, counts, budget status and shortcuts. Use it to see the whole plan before editing." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const lines = l.trip.days.map((d, i) => `${dayLabel(l.trip, i)}: ${d.activities.filter((x) => !isBlank(x)).map((x) => `${x.time || "--"} ${x.title}`).join("; ") || "(empty)"}`);
      return card(`${l.id} — ${summary(l.trip)}. Role: ${l.role}. Start: ${l.trip.startDate || "unset"}. Currency: ${l.trip.currency}. Budget cap: ${l.trip.budget || "none"}.\n${lines.join("\n")}`, tripPage(l));
    });

  tool("get_day", { title: "📅 Day", annotations: READ, inputSchema: { tripId, ...dayRef },
    description: "One day in full: timeline of activities (with ids), hotel and linked documents. Pass dayNumber (1-based) or dayId." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const { day, index } = findDay(l.trip, a);
      const lines = day.activities.filter((x) => !isBlank(x)).map((x) => `[${x.id}] ${x.time || "--:--"} ${x.title || "(untitled)"} (${x.category}${x.cost ? `, cost ${x.cost}` : ""})`);
      return card(`${dayLabel(l.trip, index)} (dayId ${day.id}) in trip ${l.id}\n${lines.join("\n") || "(no activities)"}\nHotel: ${day.hotel.name || "none"}`, dayPage(l, index));
    });

  tool("list_ideas", { title: "💡 Ideas", annotations: READ,
    inputSchema: { tripId, status: z.enum(["open", "scheduled", "excluded", "all"]).default("open").describe("open = not yet in the itinerary."), category: z.enum(["sight", "food"]).optional() },
    description: "The pool of attraction/restaurant ideas not yet scheduled (or filtered by status/category), with ids. Use schedule_idea to place one in a day." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const rows = l.trip.attractionIdeas.filter((i) => (a.category ? i.category === a.category : true) && (a.status === "all" ? true : a.status === "scheduled" ? i.scheduled : a.status === "excluded" ? i.excluded : !i.scheduled && !i.excluded));
      return card(rows.length ? rows.map((i) => `[${i.id}] ${i.nameHe || i.nameEn} (${i.category}${i.priority ? `, ${i.priority}` : ""}${i.scheduled ? ", scheduled" : ""})`).join("\n") : "No ideas match.", {
        kind: "page", title: "💡 רעיונות לאטרקציות", sub: `${l.trip.name} · ${rows.length} תוצאות`,
        sections: [{ items: rows.map(ideaItem), empty: "אין רעיונות בסינון הזה." }],
      });
    });

  tool("list_documents", { title: "📄 Documents", annotations: READ, inputSchema: { tripId, type: z.enum(["flight", "hotel", "car", "general"]).optional() },
    description: "Bookings and documents of the trip (flights, hotels, car rentals, general) with ids and key details." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const rows = l.trip.documents.filter((d) => !a.type || d.type === a.type);
      return card(rows.length ? rows.map((d) => `[${d.id}] ${d.type}: ${d.title} ${d.flightNumber} ${d.confirmationNumber}`.trim()).join("\n") : "No documents.", {
        kind: "page", title: "📄 מסמכים והזמנות", sub: l.trip.name, sections: [{ items: rows.map(docItem), empty: "אין מסמכים." }],
      });
    });

  tool("get_budget", { title: "💰 Budget", annotations: READ, inputSchema: { tripId },
    description: "Planned spend per day (activities + hotel, converted to the trip's main currency using the app's fixed approximate rates) versus the budget cap, plus the price of unscheduled ideas." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const b = budgetOf(l.trip);
      const max = Math.max(...b.perDay.map((d) => d.total), 1);
      return card(`Planned total ${money(b.total, b.primary)}${b.cap ? ` of cap ${money(b.cap, b.primary)} (left ${money(b.left!, b.primary)})` : " (no cap set)"}. Unscheduled ideas add ~${money(b.ideasCost, b.primary)}.\n` + b.perDay.map((d) => `${d.label}: ${money(d.total, b.primary)}`).join("\n"), {
        kind: "page", title: "💰 תקציב", sub: `${l.trip.name} · שערי חליפין משוערים וקבועים`,
        chips: [`סה״כ ${money(b.total, b.primary)}`, b.cap ? `תקרה ${money(b.cap, b.primary)}` : "אין תקרה", b.left != null ? (b.left >= 0 ? `נשאר ${money(b.left, b.primary)}` : `חריגה ${money(-b.left, b.primary)}`) : "", b.ideasCost ? `רעיונות פתוחים ~${money(b.ideasCost, b.primary)}` : ""].filter(Boolean),
        bars: [
          ...(b.cap ? [{ label: "סה״כ מול תקרה", text: `${money(b.total, b.primary)} / ${money(b.cap, b.primary)}`, value: b.total, max: b.cap, over: b.total > b.cap }] : []),
          ...b.perDay.map((d) => ({ label: d.label, text: money(d.total, b.primary), value: d.total, max })),
        ],
      });
    });

  tool("get_sharing", { title: "👥 Sharing", annotations: READ, inputSchema: { tripId },
    description: "Trip members with display names and roles. Invite codes are included only when the connector user is the owner." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const members = Object.entries(l.trip.members ?? {});
      const names = await Promise.all(members.map(async ([uid]) => (await store().get(`users/${uid}`).catch(() => null))?.data.name || ""));
      const codes = l.role === "owner" ? l.trip.codes ?? {} : {};
      return card(members.map(([uid, r], i) => `${names[i] || uid} (${uid}): ${r}`).join("\n") + (Object.keys(codes).length ? `\nInvite codes: ${JSON.stringify(codes)}` : ""), {
        kind: "page", title: "👥 שיתוף", sub: l.trip.name,
        sections: [
          { heading: "חברים", items: members.map(([uid, r], i) => ({ icon: "👤", title: names[i] || uid, sub: uid === l.uid ? "משתמש המחבר" : uid, badge: roleHe[r as keyof typeof roleHe] })) },
          Object.keys(codes).length ? { heading: "קודי הצטרפות", items: Object.entries(codes).map(([r, c]) => ({ icon: "🔑", title: String(c), badge: roleHe[r as keyof typeof roleHe] })) } : null,
        ].filter(Boolean),
      });
    });

  tool("get_packing_list", { title: "🎒 Packing list", annotations: READ, inputSchema: { tripId },
    description: "The connector user's PRIVATE packing list for the trip (each trip member has their own). Items have ids for update_packing_item." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { items, videos } = await readPacking(id);
      return card(items.length ? items.map((i) => `[${i.id}] ${i.checked ? "[x]" : "[ ]"} ${i.text}`).join("\n") : "Packing list is empty.", packingPage(id, items, videos));
    });

  tool("list_suggestions", { title: "📨 Packing suggestions", annotations: READ, inputSchema: { tripId },
    description: "Packing-item suggestions that trip members sent (to a person or to everyone), with the connector user's response." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const rows = (await store().list(`trips/${l.id}/suggestions`)).filter((d) => (d.data.to ?? []).some((t: string) => t === "*" || t === l.uid));
      return card(rows.length ? rows.map((d) => `[${d.id}] ${d.data.text} (from ${d.data.from}; my response: ${d.data.responses?.[l.uid] ?? "none"})`).join("\n") : "No suggestions.", {
        kind: "page", title: "📨 הצעות אריזה", sub: l.trip.name,
        sections: [{ items: rows.map((d) => ({ icon: "🎒", title: d.data.text, sub: `מאת ${d.data.from}`, badge: d.data.responses?.[l.uid] === "accepted" ? "התקבל" : d.data.responses?.[l.uid] === "dismissed" ? "נדחה" : "ממתין" })), empty: "אין הצעות." }],
      });
    });

  tool("get_activity_feed", { title: "🔔 Activity feed", annotations: READ, inputSchema: { tripId, limit: z.number().int().min(1).max(50).default(15) },
    description: "Recent 'who did what' log of the trip (e.g. an idea was scheduled), newest first." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const rows = (await store().list(`trips/${l.id}/activityLog`)).sort((x, y) => (y.data.createdAt ?? 0) - (x.data.createdAt ?? 0)).slice(0, a.limit);
      const when = (t: number) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "");
      return card(rows.length ? rows.map((d) => `${when(d.data.createdAt)} ${d.data.text}`).join("\n") : "No activity yet.", {
        kind: "page", title: "🔔 פעילות אחרונה", sub: l.trip.name,
        sections: [{ items: rows.map((d) => ({ icon: "•", title: d.data.text, sub: when(d.data.createdAt) })), empty: "אין פעילות." }],
      });
    });

  tool("get_my_profile", { title: "🙋 Connector profile", annotations: READ, inputSchema: {},
    description: "Shows which Firebase user the connector acts as (uid and display name). Packing lists and suggestions belong to this user." },
    async () => {
      const uid = await store().uid();
      const name = (await store().get(`users/${uid}`))?.data.name || "";
      return card(`Connector user: ${name || "(no display name)"} (${uid})`, { kind: "page", title: "🙋 משתמש המחבר", rows: [["שם תצוגה", name || "לא הוגדר"], ["uid", uid]], note: "ניתן לשנות עם set_display_name." });
    });

  // ================================================================ TRIPS
  tool("create_trip", { title: "➕ Create trip", annotations: WRITE,
    inputSchema: { name: str(120).describe("Trip name, e.g. 'יפן 2026'."), startDate: date.optional(), currency: currency.default("ILS"), secondaryCurrency: currency.optional(), budget: amount.optional().describe("Budget cap in the main currency."), days: z.number().int().min(1).max(60).default(1).describe("How many empty days to create.") },
    description: "Creates a new trip owned by the connector user, with empty days and fresh invite codes. Returns the tripId." },
    async (a) => {
      const st = store();
      const uid = await st.uid();
      const id = st.newId();
      const codes = { owner: code8(), editor: code8(), viewer: code8() };
      const trip = {
        name: a.name, startDate: a.startDate ?? "", currency: a.currency, secondaryCurrency: a.secondaryCurrency ?? "", budget: a.budget ?? "",
        dayHourOverrides: {}, days: Array.from({ length: a.days }, () => normalizeDay()), attractionIdeas: [], dayGroups: [], documents: [], archived: false,
        members: { [uid]: "owner" }, codes,
      };
      await st.write(`trips/${id}`, trip, { serverTime: ["createdAt", "updatedAt"], mode: "create" });
      await Promise.all(Object.entries(codes).map(([role, code]) => st.write(`tripCodes/${code}`, { tripId: id, role }, { mode: "create" })));
      const l = await loadTrip(id);
      return card(`Created trip ${id} "${a.name}" with ${a.days} day(s).`, tripPage(l));
    });

  tool("update_trip", { title: "⚙️ Trip settings", annotations: WRITE,
    inputSchema: { tripId, name: str(120).optional(), startDate: date.or(z.literal("")).optional(), currency: currency.optional(), secondaryCurrency: currency.or(z.literal("")).optional(), budget: amount.or(z.literal("")).optional().describe("Budget cap; empty string removes it."), archived: z.boolean().optional().describe("true archives the trip, false restores it.") },
    description: "Changes trip settings: name, start date, main/secondary currency, budget cap, archived flag. Only the fields you pass change." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const keys = ["name", "startDate", "currency", "secondaryCurrency", "budget", "archived"].filter((k) => a[k] !== undefined);
      if (!keys.length) return fail("⚠️ Pass at least one setting to change.");
      const { trip, role } = await mutateTrip(id, keys, (t) => { patch(t, a, keys); });
      return card(`Updated settings of ${id}: ${summary(trip)}.`, tripPage({ id, trip, role }));
    });

  tool("delete_trip", { title: "🗑️ Delete trip", annotations: DELETE,
    inputSchema: { tripId: z.string().min(1).max(60), confirmName: str(120).describe("Must equal the trip's current name exactly; protects against deleting the wrong trip.") },
    description: "PERMANENTLY deletes a trip and its invite codes. Owner only. Ask the user to confirm first; confirmName must match the trip name." },
    async (a) => {
      const l = await loadTrip(a.tripId);
      requireOwner(l);
      if ((l.trip.name || "") !== a.confirmName) return fail(`⚠️ confirmName does not match the trip name "${l.trip.name}". Nothing was deleted.`);
      const st = store();
      await st.remove(`trips/${l.id}`);
      await Promise.all(Object.values(l.trip.codes ?? {}).map((c) => st.remove(`tripCodes/${c}`).catch(() => {})));
      return textOnly(`Deleted trip "${l.trip.name}" (${l.id}).`);
    });

  // ================================================================ DAYS
  tool("add_day", { title: "➕ Add day", annotations: WRITE, inputSchema: { tripId, destination: str(100).optional(), currency: currency.optional(), atNumber: z.number().int().min(1).max(400).optional().describe("Insert as this day number; default: at the end.") },
    description: "Adds an empty day to the trip (optionally with a destination and insertion position)." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: idx } = await mutateTrip(id, ["days"], (t) => {
        const d = normalizeDay({ destination: a.destination, currency: a.currency });
        const at = a.atNumber ? Math.min(a.atNumber - 1, t.days.length) : t.days.length;
        t.days.splice(at, 0, d);
        return at;
      });
      return card(`Added day ${idx + 1} (id ${trip.days[idx].id}).`, dayPage({ id, trip }, idx));
    });

  tool("update_day", { title: "✏️ Edit day", annotations: WRITE, inputSchema: { tripId, ...dayRef, destination: str(100).optional(), currency: currency.or(z.literal("")).optional().describe("Day currency; empty = trip default."), ...hotelFields },
    description: "Edits a day's destination, currency and hotel (name, link, cost, notes, breakfast, check-in/out dates). Only passed fields change." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: idx } = await mutateTrip(id, ["days"], (t) => {
        const { day, index } = findDay(t, a);
        patch(day, a, ["destination", "currency"]);
        patch(day.hotel, { name: a.hotelName, link: a.hotelLink, cost: a.hotelCost, notes: a.hotelNotes, breakfast: a.breakfast, checkIn: a.checkIn, checkOut: a.checkOut }, Object.keys(day.hotel));
        return index;
      });
      return card(`Updated day ${idx + 1}.`, dayPage({ id, trip }, idx));
    });

  tool("delete_day", { title: "🗑️ Delete day", annotations: DELETE, inputSchema: { tripId, ...dayRef },
    description: "Deletes a day together with all its activities. Documents linked to the day are kept but unlinked. Confirm with the user first." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, role, result: n } = await mutateTrip(id, ["days", "documents"], (t) => {
        const { day, index } = findDay(t, a);
        t.days.splice(index, 1);
        t.documents.forEach((d) => { if (d.dayId === day.id) d.dayId = ""; });
        return index + 1;
      });
      return card(`Deleted day ${n}. ${summary(trip)}.`, tripPage({ id, trip, role }));
    });

  // ================================================================ ACTIVITIES
  tool("add_activity", { title: "➕ Add activity", annotations: WRITE, inputSchema: { tripId, ...dayRef, title: str(200).describe("Activity name, e.g. 'מוזיאון הלובר'."), ...activityFields },
    description: "Adds an activity (sight, meal or transport) to a day's timeline. Returns the updated day with the new activity id." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result } = await mutateTrip(id, ["days"], (t) => {
        const { day, index } = findDay(t, a);
        const act = normalizeActivity(patch({}, a, activityKeys));
        if (day.activities.length === 1 && isBlank(day.activities[0])) day.activities[0] = act; else day.activities.push(act);
        return { index, id: act.id };
      });
      return card(`Added activity ${result.id} to day ${result.index + 1}.`, dayPage({ id, trip }, result.index));
    });

  tool("update_activity", { title: "✏️ Edit activity", annotations: WRITE, inputSchema: { tripId, activityId: z.string().max(80).describe("Activity id from get_day."), title: str(200).optional(), ...activityFields },
    description: "Edits an activity by id (title, time, cost, notes, booking...). Only passed fields change." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: di } = await mutateTrip(id, ["days"], (t) => {
        const f = findActivity(t, a.activityId);
        patch(f.activity, a, activityKeys);
        return f.dayIndex;
      });
      return card(`Updated activity ${a.activityId}.`, dayPage({ id, trip }, di));
    });

  tool("delete_activity", { title: "🗑️ Delete activity", annotations: DELETE, inputSchema: { tripId, activityId: z.string().max(80) },
    description: "Removes an activity from its day. If it came from an idea, that idea becomes unscheduled again." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: di } = await mutateTrip(id, ["days", "attractionIdeas"], (t) => {
        const f = findActivity(t, a.activityId);
        f.day.activities.splice(f.index, 1);
        if (!f.day.activities.length) f.day.activities.push(normalizeActivity());
        const idea = t.attractionIdeas.find((i) => i.id === f.activity.sourceIdeaId);
        if (idea) idea.scheduled = false;
        return f.dayIndex;
      });
      return card(`Deleted activity ${a.activityId}.`, dayPage({ id, trip }, di));
    });

  tool("move_activity", { title: "↔️ Move activity", annotations: WRITE, inputSchema: { tripId, activityId: z.string().max(80), toDayNumber: z.number().int().min(1).max(400).optional(), toDayId: z.string().max(80).optional(), time: time.optional().describe("New start time (optional).") },
    description: "Moves an activity to another day (and optionally changes its time)." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: ti } = await mutateTrip(id, ["days"], (t) => {
        const f = findActivity(t, a.activityId);
        const target = findDay(t, { dayNumber: a.toDayNumber, dayId: a.toDayId });
        f.day.activities.splice(f.index, 1);
        if (!f.day.activities.length) f.day.activities.push(normalizeActivity());
        if (a.time) f.activity.time = a.time;
        if (target.day.activities.length === 1 && isBlank(target.day.activities[0])) target.day.activities[0] = f.activity; else target.day.activities.push(f.activity);
        return target.index;
      });
      return card(`Moved activity ${a.activityId} to day ${ti + 1}.`, dayPage({ id, trip }, ti));
    });

  // ================================================================ IDEAS
  tool("add_idea", { title: "💡 Add idea", annotations: WRITE, inputSchema: { tripId, ...ideaFields },
    description: "Adds an attraction/restaurant idea to the pool (not yet in the itinerary). Give at least nameHe or nameEn." },
    async (a) => {
      if (!a.nameHe && !a.nameEn) return fail("⚠️ Provide nameHe or nameEn.");
      const id = await resolveTripId(a.tripId);
      const uid = await store().uid();
      const { trip, result } = await mutateTrip(id, ["attractionIdeas"], (t) => {
        const idea = normalizeIdea({ ...patch({}, a, Object.keys(ideaFields)), createdAt: Date.now(), createdBy: uid });
        t.attractionIdeas.push(idea);
        return idea.id;
      });
      return card(`Added idea ${result}.`, { kind: "page", title: "💡 נוסף רעיון", sub: trip.name, sections: [{ items: trip.attractionIdeas.filter((i) => i.id === result).map(ideaItem) }] });
    });

  tool("update_idea", { title: "✏️ Edit idea", annotations: WRITE, inputSchema: { tripId, ideaId: z.string().max(80), ...ideaFields },
    description: "Edits an idea by id. Only passed fields change." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip } = await mutateTrip(id, ["attractionIdeas"], (t) => { patch(findIdea(t, a.ideaId), a, Object.keys(ideaFields)); });
      return card(`Updated idea ${a.ideaId}.`, { kind: "page", title: "💡 רעיון עודכן", sub: trip.name, sections: [{ items: trip.attractionIdeas.filter((i) => i.id === a.ideaId).map(ideaItem) }] });
    });

  tool("delete_idea", { title: "🗑️ Delete idea", annotations: DELETE, inputSchema: { tripId, ideaId: z.string().max(80) },
    description: "Deletes an idea and removes it from any day groups." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, role } = await mutateTrip(id, ["attractionIdeas", "dayGroups"], (t) => {
        findIdea(t, a.ideaId);
        t.attractionIdeas = t.attractionIdeas.filter((i) => i.id !== a.ideaId);
        t.dayGroups.forEach((g) => { g.ideaIds = g.ideaIds.filter((x: string) => x !== a.ideaId); });
      });
      return card(`Deleted idea ${a.ideaId}.`, tripPage({ id, trip, role }));
    });

  tool("schedule_idea", { title: "📌 Schedule idea", annotations: WRITE, inputSchema: { tripId, ideaId: z.string().max(80), ...dayRef, time: time.optional() },
    description: "Moves an idea from the pool into a day's timeline as an activity (copies its details) and marks the idea as scheduled." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, result: di } = await mutateTrip(id, ["days", "attractionIdeas"], (t) => {
        const idea = findIdea(t, a.ideaId);
        const { day, index } = findDay(t, a);
        const act = normalizeActivity({
          title: idea.nameHe || idea.nameEn, time: a.time ?? "", category: idea.category, cuisine: idea.cuisine, cost: idea.price, link: idea.link, notes: idea.notes,
          duration: idea.duration, priority: idea.priority, hours: idea.hours, booking: idea.booking, equipment: idea.equipment, partySize: idea.partySize, mapQuery: idea.mapQuery, sourceIdeaId: idea.id, rating: idea.rating,
        });
        if (day.activities.length === 1 && isBlank(day.activities[0])) day.activities[0] = act; else day.activities.push(act);
        idea.scheduled = true;
        return index;
      });
      return card(`Scheduled idea ${a.ideaId} on day ${di + 1}.`, dayPage({ id, trip }, di));
    });

  // ================================================================ DOCUMENTS
  tool("add_document", { title: "➕ Add document", annotations: WRITE, inputSchema: { tripId, ...dayRef, ...documentFields },
    description: "Adds a booking/document: flight (flightNumber, depTime, arrTime, gate), hotel (address, checkIn, checkOut), car (company, pickupInfo, returnInfo) or general. Optionally link it to a day." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const uid = await store().uid();
      const { trip, result } = await mutateTrip(id, ["documents"], (t) => {
        const dayId = a.dayId || (a.dayNumber ? findDay(t, a).day.id : "");
        const d = normalizeDocument({ ...patch({}, a, Object.keys(documentFields)), dayId, createdAt: Date.now(), createdBy: uid });
        t.documents.push(d);
        return d.id;
      });
      return card(`Added document ${result}.`, { kind: "page", title: "📄 נוסף מסמך", sub: trip.name, sections: [{ items: trip.documents.filter((d) => d.id === result).map(docItem) }] });
    });

  tool("update_document", { title: "✏️ Edit document", annotations: WRITE, inputSchema: { tripId, documentId: z.string().max(80), ...dayRef, ...documentFields },
    description: "Edits a document by id (and optionally re-links it to a day). Only passed fields change." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip } = await mutateTrip(id, ["documents"], (t) => {
        const d = t.documents.find((x) => x.id === a.documentId);
        if (!d) throw new UpstreamError(`Document "${a.documentId}" not found.`, "triplan", 404);
        patch(d, a, Object.keys(documentFields));
        if (a.dayId) d.dayId = a.dayId; else if (a.dayNumber) d.dayId = findDay(t, a).day.id;
      });
      return card(`Updated document ${a.documentId}.`, { kind: "page", title: "📄 מסמך עודכן", sub: trip.name, sections: [{ items: trip.documents.filter((d) => d.id === a.documentId).map(docItem) }] });
    });

  tool("delete_document", { title: "🗑️ Delete document", annotations: DELETE, inputSchema: { tripId, documentId: z.string().max(80) },
    description: "Deletes a document by id." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, role } = await mutateTrip(id, ["documents"], (t) => {
        if (!t.documents.some((d) => d.id === a.documentId)) throw new UpstreamError(`Document "${a.documentId}" not found.`, "triplan", 404);
        t.documents = t.documents.filter((d) => d.id !== a.documentId);
      });
      return card(`Deleted document ${a.documentId}.`, tripPage({ id, trip, role }));
    });

  // ================================================================ DAY GROUPS
  tool("save_day_group", { title: "🧩 Day group", annotations: WRITE, inputSchema: { tripId, groupId: z.string().max(80).optional().describe("Omit to create a new group."), label: str(100).optional(), ideaIds: z.array(z.string().max(80)).max(100).optional().describe("Idea ids that belong together on one day.") },
    description: "Creates or edits a 'day group': ideas planned to happen together on the same day before a specific day is chosen." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const uid = await store().uid();
      const { trip, result } = await mutateTrip(id, ["dayGroups"], (t) => {
        let g = a.groupId ? t.dayGroups.find((x) => x.id === a.groupId) : undefined;
        if (a.groupId && !g) throw new UpstreamError(`Group "${a.groupId}" not found.`, "triplan", 404);
        if (!g) { g = normalizeGroup({ label: a.label || `קבוצה ${t.dayGroups.length + 1}`, createdAt: Date.now(), createdBy: uid }); t.dayGroups.push(g); }
        patch(g, a, ["label", "ideaIds"]);
        return g.id;
      });
      const g = trip.dayGroups.find((x) => x.id === result)!;
      return card(`Saved group ${result}.`, { kind: "page", title: `🧩 ${g.label}`, sub: trip.name, sections: [{ items: g.ideaIds.map((i: string) => { const idea = trip.attractionIdeas.find((x) => x.id === i); return { icon: "💡", title: idea ? idea.nameHe || idea.nameEn : i }; }), empty: "הקבוצה ריקה." }] });
    });

  tool("delete_day_group", { title: "🗑️ Delete group", annotations: DELETE, inputSchema: { tripId, groupId: z.string().max(80) }, description: "Deletes a day group (the ideas themselves stay)." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { trip, role } = await mutateTrip(id, ["dayGroups"], (t) => {
        if (!t.dayGroups.some((g) => g.id === a.groupId)) throw new UpstreamError(`Group "${a.groupId}" not found.`, "triplan", 404);
        t.dayGroups = t.dayGroups.filter((g) => g.id !== a.groupId);
      });
      return card(`Deleted group ${a.groupId}.`, tripPage({ id, trip, role }));
    });

  // ================================================================ PACKING (private to the connector user)
  tool("add_packing_item", { title: "➕ Add packing item", annotations: WRITE, inputSchema: { tripId, text: str(200).describe("Item, e.g. 'מטען לטלפון'."), dueDaysBefore: z.number().int().min(0).max(365).optional().describe("Reminder: pack this N days before the trip.") },
    description: "Adds an item to the connector user's private packing list of the trip." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { items, videos } = await mutatePacking(id, (items) => { items.push(normalizePackingItem({ text: a.text, dueDaysBefore: a.dueDaysBefore })); });
      return card(`Added "${a.text}". ${items.length} items.`, packingPage(id, items, videos));
    });

  tool("update_packing_item", { title: "☑️ Update packing item", annotations: WRITE, inputSchema: { tripId, itemId: z.string().max(80), text: str(200).optional(), checked: z.boolean().optional().describe("true = packed."), dueDaysBefore: z.number().int().min(0).max(365).optional() },
    description: "Checks/unchecks or renames a packing item by id." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { items, videos } = await mutatePacking(id, (items) => {
        const it = items.find((x) => x.id === a.itemId);
        if (!it) throw new UpstreamError(`Packing item "${a.itemId}" not found.`, "triplan", 404);
        patch(it, { ...a, dueDaysBefore: a.dueDaysBefore === undefined ? undefined : String(a.dueDaysBefore) }, ["text", "checked", "dueDaysBefore"]);
      });
      return card(`Updated item ${a.itemId}.`, packingPage(id, items, videos));
    });

  tool("delete_packing_item", { title: "🗑️ Delete packing item", annotations: DELETE, inputSchema: { tripId, itemId: z.string().max(80) }, description: "Removes an item from the connector user's packing list." },
    async (a) => {
      const id = await resolveTripId(a.tripId);
      const { items, videos } = await mutatePacking(id, (items) => {
        const i = items.findIndex((x) => x.id === a.itemId);
        if (i < 0) throw new UpstreamError(`Packing item "${a.itemId}" not found.`, "triplan", 404);
        items.splice(i, 1);
      });
      return card(`Deleted item ${a.itemId}.`, packingPage(id, items, videos));
    });

  // ================================================================ SOCIAL / MEMBERS
  tool("send_suggestion", { title: "📨 Suggest packing item", annotations: WRITE, inputSchema: { tripId, text: str(200), toUids: z.array(z.string().max(80)).max(30).default(["*"]).describe("Member uids from get_sharing, or ['*'] for everyone.") },
    description: "Sends a packing-item suggestion from the connector user to specific members or to everyone." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const sid = store().newId();
      await store().write(`trips/${l.id}/suggestions/${sid}`, { from: l.uid, to: a.toUids, text: a.text, responses: {} }, { serverTime: ["createdAt"], mode: "create" });
      return textOnly(`Suggestion sent (${sid}).`);
    });

  tool("respond_suggestion", { title: "✅ Respond to suggestion", annotations: WRITE, inputSchema: { tripId, suggestionId: z.string().max(80), response: z.enum(["accepted", "dismissed"]) },
    description: "Accepts or dismisses a packing suggestion as the connector user." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      const path = `trips/${l.id}/suggestions/${a.suggestionId}`;
      const doc = await store().get(path);
      if (!doc) return fail("⚠️ Suggestion not found.");
      const responses = { ...(doc.data.responses ?? {}), [l.uid]: a.response };
      await store().write(path, { responses }, { mask: ["responses"], ifUpdateTime: doc.updateTime, mode: "update" });
      return textOnly(`Marked suggestion ${a.suggestionId} as ${a.response}.`);
    });

  tool("join_trip", { title: "🔑 Join by code", annotations: WRITE, inputSchema: { code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/, "invite code, e.g. K7M2QX9A") },
    description: "Makes the connector user join an existing trip with an invite code (the role comes from the code)." },
    async ({ code }) => {
      const st = store();
      const uid = await st.uid();
      const c = await st.get(`tripCodes/${code}`);
      if (!c) return fail("⚠️ Invite code not found.");
      const trip = await st.get(`trips/${c.data.tripId}`).catch(() => null);
      if (trip?.data.members?.[uid]) return textOnly("Already a member of this trip.");
      await st.write(`trips/${c.data.tripId}`, { members: { [uid]: c.data.role }, lastJoinCode: code }, { mask: ["members.`" + uid + "`", "lastJoinCode"], mode: "update" });
      const l = await loadTrip(c.data.tripId);
      return card(`Joined trip ${l.id} as ${l.role}.`, tripPage(l));
    });

  tool("regenerate_invite_code", { title: "🔄 New invite code", annotations: WRITE, inputSchema: { tripId, role: z.enum(["owner", "editor", "viewer"]) },
    description: "Owner only: replaces the invite code for a role (the old code stops working) and returns the new one." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      requireOwner(l);
      const st = store();
      const code = code8();
      const old = l.trip.codes?.[a.role];
      await st.write(`tripCodes/${code}`, { tripId: l.id, role: a.role }, { mode: "create" });
      await st.write(`trips/${l.id}`, { codes: { ...(l.trip.codes ?? {}), [a.role]: code } }, { mask: ["codes"], mode: "update" });
      if (old) await st.remove(`tripCodes/${old}`).catch(() => {});
      return card(`New ${a.role} code: ${code}`, { kind: "page", title: "🔑 קוד הצטרפות חדש", sub: l.trip.name, rows: [["תפקיד", roleHe[a.role as keyof typeof roleHe]], ["קוד", code]] });
    });

  tool("remove_member", { title: "👋 Remove member", annotations: DELETE, inputSchema: { tripId, uid: z.string().max(80).describe("Member uid from get_sharing.") },
    description: "Owner only: removes a member from the trip. Cannot remove the connector user itself. Confirm with the user first." },
    async (a) => {
      const l = await loadTrip(await resolveTripId(a.tripId));
      requireOwner(l);
      if (a.uid === l.uid) return fail("⚠️ The connector user cannot remove itself.");
      const members = { ...(l.trip.members ?? {}) };
      if (!members[a.uid]) return fail("⚠️ That uid is not a member.");
      delete members[a.uid];
      await store().write(`trips/${l.id}`, { members }, { mask: ["members"], mode: "update" });
      return textOnly(`Removed member ${a.uid}.`);
    });

  tool("set_display_name", { title: "🪪 Set display name", annotations: WRITE, inputSchema: { name: str(60).min(1).describe("Name other trip members see for the connector user.") },
    description: "Sets the display name of the connector user (shown to other members instead of a raw uid)." },
    async ({ name }) => {
      const uid = await store().uid();
      await store().write(`users/${uid}`, { name }, { mask: ["name"] });
      return card(`Display name set to "${name}".`, { kind: "page", title: "🪪 שם התצוגה עודכן", rows: [["שם", name], ["uid", uid]] });
    });

  return server;
}
