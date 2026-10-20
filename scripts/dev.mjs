// Dev loop: Vite on :1420, the main process compiled with tsc --watch, and
// Electron pointed at the dev server. Ctrl+C stops all three.
import { spawn } from "node:child_process";
import { createServer } from "vite";

const procs = [];
const stop = (code = 0) => {
  for (const p of procs) p.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:1420/";

const run = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  procs.push(p);
  return p;
};

await new Promise((resolve, reject) => {
  run("npx", ["tsc", "-p", "electron/tsconfig.json"]).on("exit", (c) => (c === 0 ? resolve() : reject(new Error("electron tsc failed"))));
});
run("npx", ["tsc", "-p", "electron/tsconfig.json", "--watch", "--preserveWatchOutput"]);
const electron = run("npx", ["electron", "."], { VITE_DEV_SERVER_URL: url });
electron.on("exit", async (code) => {
  await server.close();
  stop(code ?? 0);
});
