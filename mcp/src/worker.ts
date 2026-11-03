// Cloudflare Workers entry. Same handler as the Vercel entry (api/mcp.ts).
// Secrets arrive in process.env through nodejs_compat_populate_process_env (see wrangler.toml).
import { handleMcp } from "./handler.js";

export default {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      return Promise.resolve(new Response("triplan connector. Use /mcp?key=<MCP_SECRET>.", { status: 404 }));
    }
    return handleMcp(request);
  },
};
