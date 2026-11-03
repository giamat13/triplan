import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./server.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};
const MAX_BODY = 64 * 1024; // abuse protection: MCP requests here are tiny

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const json = (status: number, message: string) =>
  withCors(
    new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

/** Constant-time string compare. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The connector acts as one Firebase user, so the endpoint must not be open to anyone with the URL.
 * - MCP_SECRET set: required, as `?key=...` (claude.ai custom connectors take a URL) or `Authorization: Bearer ...`.
 * - MCP_SECRET unset: allowed only in mock mode (TRIPLAN_MOCK=1, in-memory data) or when no Firebase user is configured.
 */
function authorized(request: Request): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    return process.env.TRIPLAN_MOCK === "1" || !(process.env.TRIPLAN_EMAIL && process.env.TRIPLAN_PASSWORD);
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const key = new URL(request.url).searchParams.get("key") ?? "";
  return same(bearer, secret) || same(key, secret);
}

/** Stateless Streamable HTTP: a fresh server + transport per request, no sessions. */
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, "Method not allowed. Use POST (stateless server).");
  if (!authorized(request))
    return json(401, "Unauthorized. Set MCP_SECRET on the server and pass it as ?key=... or a Bearer token.");
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return withCors(new Response("Payload too large", { status: 413 }));

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    // Close after the response has been produced; nothing is kept between requests.
    queueMicrotask(() => void server.close().catch(() => {}));
  }
}
