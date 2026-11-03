// Domain layer: trip documents as the triplan web app stores them (see index.html: tripContentPayload & normalize*).
import { UpstreamError } from "./http.js";
import { ConflictError, store, type Doc } from "./firestore.js";

export type Role = "owner" | "editor" | "viewer";
export const CONTENT_FIELDS = [
  "name", "startDate", "currency", "secondaryCurrency", "budget", "dayHourOverrides",
  "days", "attractionIdeas", "dayGroups", "documents", "archived",
] as const;

export const RATES: Record<string, number> = {
  USD: 1, ILS: 3.7, EUR: 0.92, GBP: 0.79, CHF: 0.88, JPY: 150, AUD: 1.52, CAD: 1.36, TRY: 34, THB: 35, AED: 3.67,
  INR: 83, CZK: 23, HUF: 365, PLN: 4.0, MXN: 17, SGD: 1.34, HKD: 7.8, CNY: 7.2, KRW: 1330, SEK: 10.5, NOK: 10.6,
  DKK: 6.9, GEL: 2.7, EGP: 49,
};
export const SYMBOLS: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", CHF: "CHF", TRY: "₺", THB: "฿", INR: "₹", KRW: "₩" };
export const sym = (c: string) => SYMBOLS[c] ?? c;

export const CATEGORY_ICON: Record<string, string> = { food: "🍴", transport: "🚌", sight: "🎫" };
export const DOC_ICON: Record<string, string> = { flight: "✈️", hotel: "🏨", car: "🚗", general: "📄" };

// ------------------------------------------------------------------ ids / normalizers
let counter = 1;
export const nextId = () => `id${counter++}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const s = (v: any) => (v == null ? "" : String(v));

export function normalizeActivity(a: any = {}) {
  return {
    id: a.id || nextId(), time: s(a.time), title: s(a.title),
    category: a.category in CATEGORY_ICON ? a.category : "sight",
    cuisine: s(a.cuisine), transport: s(a.transport), cost: s(a.cost), link: s(a.link), notes: s(a.notes),
    duration: s(a.duration), priority: s(a.priority), hours: s(a.hours), booking: !!a.booking, equipment: s(a.equipment),
    partySize: s(a.partySize), confirmation: s(a.confirmation), mapQuery: s(a.mapQuery), sourceIdeaId: s(a.sourceIdeaId),
    rating: s(a.rating), aiBudgetDismissedCost: s(a.aiBudgetDismissedCost),
  };
}
export function normalizeDay(d: any = {}) {
  const h = d.hotel ?? {};
  return {
    id: d.id || nextId(), destination: s(d.destination), currency: s(d.currency),
    activities: Array.isArray(d.activities) && d.activities.length ? (d.activities as any[]).map(normalizeActivity) : [normalizeActivity()],
    hotel: { name: s(h.name), link: s(h.link), cost: s(h.cost), notes: s(h.notes), breakfast: !!h.breakfast, checkIn: s(h.checkIn), checkOut: s(h.checkOut) },
    lastEditedBy: s(d.lastEditedBy), lastEditedAt: d.lastEditedAt || 0, aiScheduleDismissed: s(d.aiScheduleDismissed),
  };
}
export function normalizeIdea(a: any = {}) {
  return {
    id: a.id || nextId(), nameEn: s(a.nameEn), nameHe: s(a.nameHe), duration: s(a.duration), priority: s(a.priority),
    hours: s(a.hours), price: s(a.price), booking: !!a.booking, equipment: s(a.equipment), notes: s(a.notes), link: s(a.link),
    cuisine: s(a.cuisine), category: a.category === "food" ? "food" : "sight", partySize: s(a.partySize), mapQuery: s(a.mapQuery),
    scheduled: !!a.scheduled, rating: s(a.rating), lat: typeof a.lat === "number" ? a.lat : null, lng: typeof a.lng === "number" ? a.lng : null,
    excluded: !!a.excluded, createdAt: a.createdAt || 0, createdBy: s(a.createdBy),
  };
}
export function normalizeDocument(d: any = {}) {
  return {
    id: d.id || nextId(), type: d.type in DOC_ICON ? d.type : "general", title: s(d.title), dayId: s(d.dayId),
    flightNumber: s(d.flightNumber), depTime: s(d.depTime), arrTime: s(d.arrTime), gate: s(d.gate),
    address: s(d.address), checkIn: s(d.checkIn), checkOut: s(d.checkOut), company: s(d.company),
    pickupInfo: s(d.pickupInfo), returnInfo: s(d.returnInfo), confirmationNumber: s(d.confirmationNumber),
    link: s(d.link), notes: s(d.notes), attachmentName: s(d.attachmentName), attachmentText: s(d.attachmentText),
    createdAt: d.createdAt || 0, createdBy: s(d.createdBy),
  };
}
export function normalizeGroup(g: any = {}) {
  return { id: g.id || nextId(), label: s(g.label), ideaIds: Array.isArray(g.ideaIds) ? g.ideaIds.filter(Boolean) : [], createdAt: g.createdAt || 0, createdBy: s(g.createdBy) };
}
export const normalizePackingItem = (p: any = {}) => ({ id: p.id || nextId(), text: s(p.text), checked: !!p.checked, dueDaysBefore: s(p.dueDaysBefore) });
export const normalizeVideo = (v: any = {}) => ({ id: v.id || nextId(), title: s(v.title), url: s(v.url), downloaded: !!v.downloaded });

/** Fill missing arrays/fields so the tools can rely on the shape. */
export function normalizeTrip(d: Record<string, any>) {
  return {
    ...d,
    name: s(d.name), startDate: s(d.startDate), currency: d.currency || "ILS", secondaryCurrency: s(d.secondaryCurrency), budget: s(d.budget),
    dayHourOverrides: d.dayHourOverrides && typeof d.dayHourOverrides === "object" ? d.dayHourOverrides : {},
    days: ((Array.isArray(d.days) ? d.days : []) as any[]).map(normalizeDay),
    attractionIdeas: ((Array.isArray(d.attractionIdeas) ? d.attractionIdeas : []) as any[]).map(normalizeIdea),
    dayGroups: ((Array.isArray(d.dayGroups) ? d.dayGroups : []) as any[]).map(normalizeGroup),
    documents: ((Array.isArray(d.documents) ? d.documents : []) as any[]).map(normalizeDocument),
    archived: !!d.archived,
  };
}
export type Trip = ReturnType<typeof normalizeTrip> & { members?: Record<string, Role>; codes?: Record<string, string> };

// ------------------------------------------------------------------ loading / saving
export interface Loaded { id: string; trip: Trip; role: Role; uid: string; updateTime?: string }

export async function loadTrip(tripId: string): Promise<Loaded> {
  const st = store();
  const [uid, doc] = await Promise.all([st.uid(), st.get(`trips/${tripId}`)]);
  if (!doc) throw new UpstreamError(`Trip "${tripId}" was not found (or the connector user is not a member). Use list_trips to see available trips.`, "triplan", 404);
  const role = doc.data.members?.[uid] as Role | undefined;
  if (!role) throw new UpstreamError(`The connector user is not a member of trip "${tripId}".`, "triplan", 403);
  return { id: doc.id, trip: normalizeTrip(doc.data) as Trip, role, uid, updateTime: doc.updateTime };
}

export async function listTrips(): Promise<{ id: string; trip: Trip; role: Role }[]> {
  const st = store();
  const [uid, docs] = await Promise.all([st.uid(), st.myTrips()]);
  return docs
    .map((d: Doc) => ({ id: d.id, trip: normalizeTrip(d.data) as Trip, role: d.data.members?.[uid] as Role }))
    .sort((a, b) => Number(a.trip.archived) - Number(b.trip.archived) || a.trip.startDate.localeCompare(b.trip.startDate));
}

/** Resolve an optional tripId: when omitted and the user has exactly one active trip, use it. */
export async function resolveTripId(tripId?: string): Promise<string> {
  if (tripId) return tripId;
  const all = (await listTrips()).filter((t) => !t.trip.archived);
  if (all.length === 1) return all[0].id;
  if (!all.length) throw new UpstreamError("No trips found. Create one with create_trip.", "triplan");
  throw new UpstreamError(`Several trips exist; pass tripId. Options: ${all.map((t) => `${t.id} (${t.trip.name || "unnamed"})`).join(", ")}`, "triplan");
}

/**
 * Read-modify-write of trip content fields with optimistic concurrency (retries on conflict).
 * `fn` mutates the normalized trip in place and may return a value.
 */
export async function mutateTrip<R>(tripId: string, fields: readonly string[], fn: (trip: Trip, l: Loaded) => R): Promise<{ trip: Trip; result: R; role: Role }> {
  for (let attempt = 0; ; attempt++) {
    const l = await loadTrip(tripId);
    if (l.role === "viewer") throw new UpstreamError("You are a viewer of this trip, so you cannot change it.", "triplan", 403);
    const result = fn(l.trip, l);
    try {
      await store().write(`trips/${tripId}`, l.trip, { mask: [...fields], serverTime: ["updatedAt"], ifUpdateTime: l.updateTime, mode: "update" });
      return { trip: l.trip, result, role: l.role };
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) continue;
      throw e;
    }
  }
}

export function requireOwner(l: Loaded) {
  if (l.role !== "owner") throw new UpstreamError("Only the trip owner can do this.", "triplan", 403);
}

// ------------------------------------------------------------------ helpers
export function findDay(trip: Trip, ref: { dayId?: string; dayNumber?: number }) {
  let idx = -1;
  if (ref.dayId) idx = trip.days.findIndex((d) => d.id === ref.dayId);
  else if (ref.dayNumber) idx = ref.dayNumber - 1;
  if (idx < 0 || idx >= trip.days.length) throw new UpstreamError(`Day not found. The trip has ${trip.days.length} day(s); pass dayNumber (1-${trip.days.length}) or dayId.`, "triplan", 404);
  return { day: trip.days[idx], index: idx };
}
export function findActivity(trip: Trip, activityId: string) {
  for (let i = 0; i < trip.days.length; i++) {
    const j = trip.days[i].activities.findIndex((a) => a.id === activityId);
    if (j >= 0) return { day: trip.days[i], dayIndex: i, activity: trip.days[i].activities[j], index: j };
  }
  throw new UpstreamError(`Activity "${activityId}" not found in this trip.`, "triplan", 404);
}
export function findIdea(trip: Trip, ideaId: string) {
  const idea = trip.attractionIdeas.find((i) => i.id === ideaId);
  if (!idea) throw new UpstreamError(`Idea "${ideaId}" not found in this trip.`, "triplan", 404);
  return idea;
}

export function dayDate(startDate: string, index: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return "";
  const d = new Date(startDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + index);
  return d.toISOString().slice(0, 10);
}
const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export function dayLabel(trip: Trip, index: number): string {
  const date = dayDate(trip.startDate, index);
  const dow = date ? ` · יום ${HE_DAYS[new Date(date + "T00:00:00Z").getUTCDay()]} ${date.slice(8)}/${date.slice(5, 7)}` : "";
  const dest = trip.days[index]?.destination;
  return `יום ${index + 1}${dest ? ` · ${dest}` : ""}${dow}`;
}

export const num = (v: any): number => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const convert = (amount: number, from: string, to: string) => (amount / (RATES[from] ?? 1)) * (RATES[to] ?? 1);

export function budgetOf(trip: Trip) {
  const primary = trip.currency;
  const perDay = trip.days.map((d, i) => {
    const cur = d.currency || primary;
    const act = d.activities.reduce((t, a) => t + num(a.cost), 0);
    const hotel = num(d.hotel.cost);
    return { index: i, label: dayLabel(trip, i), cur, activities: act, hotel, total: convert(act + hotel, cur, primary) };
  });
  const ideasCost = trip.attractionIdeas.filter((i) => !i.scheduled && !i.excluded).reduce((t, i) => t + num(i.price), 0);
  const total = perDay.reduce((t, d) => t + d.total, 0);
  const cap = num(trip.budget);
  return { primary, perDay, total, cap, ideasCost, left: cap ? cap - total : null };
}
export const money = (n: number, cur: string) => `${sym(cur)}${Math.round(n).toLocaleString("en-US")}`;
