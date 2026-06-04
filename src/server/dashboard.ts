import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { Store } from "./store";

/**
 * Host-only dashboard. Binds to 127.0.0.1 (never exposed to the internet) and
 * serves a live view of the pool, matches, and deals from the store. This is
 * the host's own window - peer privacy is unaffected.
 */
export function startDashboard(store: Store, port = 4319): Server {
  const pagePath = join(process.cwd(), "viewer", "dashboard.html");
  const server = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/api/state")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(store.snapshot()));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(pagePath));
  });
  server.listen(port, "127.0.0.1", () => console.log(`dashboard: http://localhost:${port}`));
  return server;
}
