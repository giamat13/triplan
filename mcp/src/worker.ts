// Cloudflare Workers entry. Same handlers as the Vercel entries (api/mcp.ts, api/v1.ts).
// Secrets arrive in process.env through nodejs_compat_populate_process_env (see wrangler.toml).
import { handleApi } from "./api.js";
import { handleMcp } from "./handler.js";

export default {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) return handleApi(request);
    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      return Promise.resolve(new Response("triplan connector. Use /mcp?key=<key>, or the REST API under /api/v1.", { status: 404 }));
    }
    return handleMcp(request);
  },
};
