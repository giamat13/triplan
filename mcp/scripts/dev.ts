// Local dev server: same handler as Vercel, exposed on http://localhost:3000/mcp (PORT env overrides)
import { createServer as httpServer } from "node:http";
import { handleMcp } from "../src/handler.js";

const port = Number(process.env.PORT ?? 3000);
httpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname !== "/mcp") {
    res.writeHead(404).end("triplan-mcp: use /mcp");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
  const response = await handleMcp(new Request(url, { method: req.method, headers, body: req.method === "POST" ? body : undefined }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`triplan-mcp listening on http://localhost:${port}/mcp`));
