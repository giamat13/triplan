// Runs a full scenario through a real MCP client and calls EVERY tool. Usage: TRIPLAN_MOCK=1 npm test [-- <url>]
// Fails (exit 1) on unexpected errors, empty output, or any registered tool missing from the scenario.
// Against a live server this creates and deletes a temporary trip "בדיקת מחבר".
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://localhost:3000/mcp";
const client = new Client({ name: "triplan-test", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const tools = await client.listTools();
console.log(`Connected to ${url}. ${tools.tools.length} tools.`);
const used = new Set<string>();
let bad = 0;

async function run(name: string, args: Record<string, unknown> = {}, expectError = false): Promise<string> {
  used.add(name);
  const t0 = Date.now();
  const r: any = await client.callTool({ name, arguments: args });
  const txt: string = r.content?.map((c: any) => c.text).join("\n") ?? "";
  const isErr = !!r.isError;
  const ok = expectError ? isErr : !isErr && txt.trim().length >= 5;
  if (!ok) bad++;
  const card = r.structuredContent?.kind ? ` card=${r.structuredContent.kind}` : "";
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${expectError ? "(expected error) " : ""}${Date.now() - t0}ms${card}\n     ${txt.split("\n")[0].slice(0, 150)}`);
  return txt;
}
const grab = (txt: string, re: RegExp) => txt.match(re)?.[1] ?? "";

// --- scenario
await run("get_my_profile");
await run("set_display_name", { name: "בודק המחבר" });
const created = await run("create_trip", { name: "בדיקת מחבר", startDate: "2026-07-01", currency: "EUR", secondaryCurrency: "ILS", budget: 2000, days: 2 });
const tripId = grab(created, /Created trip (\S+)/);
if (!tripId) { console.log("no tripId, abort"); process.exit(1); }
const T = { tripId };

await run("list_trips");
await run("get_trip", T);
await run("update_trip", { ...T, name: "בדיקת מחבר", budget: 1500 });
await run("update_trip", T, true);
await run("add_day", { ...T, destination: "פריז" });
await run("update_day", { ...T, dayNumber: 1, destination: "רומא", hotelName: "Hotel Roma", hotelCost: 120, breakfast: true, checkIn: "2026-07-01", checkOut: "2026-07-03" });
const act = await run("add_activity", { ...T, dayNumber: 1, title: "קולוסיאום", time: "10:00", cost: 25, category: "sight", booking: true });
const actId = grab(act, /Added activity (\S+) /);
const act2 = await run("add_activity", { ...T, dayNumber: 1, title: "פיצה", time: "13:30", cost: 15, category: "food" });
await run("update_activity", { ...T, activityId: actId, notes: "להזמין מראש", cost: 30 });
await run("move_activity", { ...T, activityId: grab(act2, /Added activity (\S+) /), toDayNumber: 2, time: "14:00" });
await run("get_day", { ...T, dayNumber: 1 });
await run("get_day", { ...T, dayNumber: 99 }, true);

const idea = await run("add_idea", { ...T, nameHe: "מזרקת טרווי", nameEn: "Trevi Fountain", category: "sight", price: 0, priority: "high" });
const ideaId = grab(idea, /Added idea (\S+)\./);
const idea2 = await run("add_idea", { ...T, nameHe: "גלידה", category: "food", price: 5 });
const idea2Id = grab(idea2, /Added idea (\S+)\./);
await run("add_idea", { ...T }, true);
await run("update_idea", { ...T, ideaId, notes: "ללכת בערב" });
await run("list_ideas", T);
await run("schedule_idea", { ...T, ideaId, dayNumber: 2, time: "20:00" });
await run("list_ideas", { ...T, status: "scheduled" });
await run("save_day_group", { ...T, label: "יום רומא", ideaIds: [idea2Id] });
const groups = await run("save_day_group", { ...T, label: "זמני" });
await run("delete_day_group", { ...T, groupId: grab(groups, /Saved group (\S+)\./) });
await run("delete_idea", { ...T, ideaId: idea2Id });

const doc = await run("add_document", { ...T, type: "flight", title: "טיסה לרומא", flightNumber: "LY381", depTime: "06:00", confirmationNumber: "ABC123", dayNumber: 1 });
const docId = grab(doc, /Added document (\S+)\./);
await run("update_document", { ...T, documentId: docId, gate: "B12" });
await run("list_documents", T);
await run("delete_document", { ...T, documentId: docId });

await run("get_budget", T);
await run("get_sharing", T);

await run("add_packing_item", { ...T, text: "מטען לטלפון", dueDaysBefore: 3 });
await run("add_packing_item", { ...T, text: "דרכון" });
const list = await run("get_packing_list", T);
const itemId = grab(list, /\[(\S+)\] \[ \] מטען/);
await run("update_packing_item", { ...T, itemId, checked: true });
await run("delete_packing_item", { ...T, itemId });

const sg = await run("send_suggestion", { ...T, text: "כובע שמש" });
await run("list_suggestions", T);
await run("respond_suggestion", { ...T, suggestionId: grab(sg, /\((\S+)\)/), response: "accepted" });
await run("get_activity_feed", T);

const code = await run("regenerate_invite_code", { ...T, role: "viewer" });
await run("join_trip", { code: grab(code, /code: (\S+)/) });
await run("remove_member", { ...T, uid: "someone-else" }, true);

await run("delete_activity", { ...T, activityId: actId });
await run("delete_day", { ...T, dayNumber: 3 });
await run("delete_trip", { ...T, confirmName: "wrong" }, true);
await run("delete_trip", { ...T, confirmName: "בדיקת מחבר" });

const untested = tools.tools.filter((t) => !used.has(t.name)).map((t) => t.name);
console.log(`\nUntested tools: ${untested.join(", ") || "none"}. Problems: ${bad}`);
await client.close();
process.exit(bad || untested.length ? 1 : 0);
