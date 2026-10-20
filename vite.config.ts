import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The opencode proxies only matter for the plain browser preview; the
// Electron build calls providers from the main process.
function opencodeProxy(path: string) {
  return {
    target: "https://opencode.ai",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/[^/]+/, path),
    configure: (proxy: {
      on: (ev: string, fn: (proxyReq: { setHeader: (k: string, v: string) => void }) => void) => void;
    }) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("User-Agent", "ai-convoir/2.0");
      });
    },
  };
}

export default defineConfig({
  // Relative so dist/index.html loads under file:// in Electron.
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/electron/**", "**/dist-electron/**", "**/release/**"],
    },
    proxy: {
      "/opencode-go": opencodeProxy("/zen/go/v1"),
      "/opencode-zen": opencodeProxy("/zen/v1"),
    },
  },
});
