import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Minimal zero-dependency static server for the replay viewer.
const dir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 5050;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  try {
    const buf = await readFile(join(dir, p));
    res.writeHead(200, {
      "content-type": types[extname(p)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, () => console.log(`murmur viewer -> http://localhost:${port}`));
