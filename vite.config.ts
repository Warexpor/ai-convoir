import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/opencode-go": {
        target: "https://opencode.ai",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencode-go/, "/zen/go/v1"),
        configure: (proxy: {
          on: (ev: string, fn: (proxyReq: { setHeader: (k: string, v: string) => void }) => void) => void;
        }) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("User-Agent", "ai-conversation/2.0");
          });
        },
      },
      "/opencode-zen": {
        target: "https://opencode.ai",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencode-zen/, "/zen/v1"),
        configure: (proxy: {
          on: (ev: string, fn: (proxyReq: { setHeader: (k: string, v: string) => void }) => void) => void;
        }) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("User-Agent", "ai-conversation/2.0");
          });
        },
      },
    },
  },
}));
