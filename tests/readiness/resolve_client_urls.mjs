// Prints the API/SSE base URLs the real browser config module resolves to in
// development (vite ssrLoadModule with the project's own vite config; DEV=true).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve vite from the frontend project (cwd), not from this script's directory.
const req = createRequire(pathToFileURL(process.cwd() + "/package.json"));
const viteDir = req.resolve("vite/package.json").replace(/package\.json$/, "");
const { createServer } = await import(pathToFileURL(viteDir + "dist/node/index.js").href);

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const cfg = await server.ssrLoadModule("/src/config/config.js");
  console.log(JSON.stringify({ api: cfg.API_BASE_URL, sse: cfg.SSE_BASE_URL }));
} finally {
  await server.close();
}
