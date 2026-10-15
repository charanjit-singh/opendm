// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// The dashboard is built into dist/client and served by Workers Static Assets (see wrangler.jsonc).
export default defineConfig({
  root: "web",
  plugins: [preact()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rollupOptions: { input: { index: "web/index.html", privacy: "web/privacy.html" } },
  },
  server: {
    // `npm run dev:web` proxies API calls to `wrangler dev`.
    proxy: { "/api": "http://127.0.0.1:8787", "/admin/oauth": "http://127.0.0.1:8787" },
  },
});
