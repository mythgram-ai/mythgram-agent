import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The browser only ever calls this app's own same-origin `/api/*` routes. In dev and
 * preview, Vite proxies those to the mythgram backend, so the browser never resolves
 * `localhost` itself — that keeps SSE streaming and CORS working even when the UI is
 * opened through a remote proxy URL.
 *
 * Crucially, the proxy is configured to NEVER time out a slow/streaming response:
 * `timeout` and `proxyTimeout` are 0 (disabled). A slow network must never be turned
 * into a failed request — only a fully-closed connection ends a stream.
 */
const MYTHGRAM_API_URL = process.env.MYTHGRAM_API_URL ?? "http://localhost:8787";
const FRONTEND_PORT = Number(process.env.VITE_PORT ?? 5173);

const proxy = {
  "/api": {
    target: MYTHGRAM_API_URL,
    changeOrigin: true,
    // Disable all proxy-level timeouts so long-running / slow SSE streams are never cut.
    timeout: 0,
    proxyTimeout: 0,
    // Keep SSE unbuffered end-to-end.
    configure: (proxyServer: { on: (e: string, cb: (...a: unknown[]) => void) => void }) => {
      proxyServer.on("proxyReq", (proxyReq: unknown) => {
        const req = proxyReq as { setHeader?: (k: string, v: string) => void };
        req.setHeader?.("X-Accel-Buffering", "no");
      });
    },
  },
} as const;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: FRONTEND_PORT,
    cors: true,
    proxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy,
  },
  resolve: {
    alias: {
      "@": path.resolve(fileURLToPath(new URL(".", import.meta.url)), "./src"),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
