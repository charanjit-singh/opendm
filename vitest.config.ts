// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: "test-password",
          SESSION_SECRET: "test-session-secret-0123456789abcdef",
          VERIFY_TOKEN: "verify-me",
          INSTAGRAM_APP_SECRET: "app-secret",
          INSTAGRAM_APP_ID: "1234567890",
          GRAPH_BASE: "https://graph.test",
          OAUTH_BASE: "https://oauth.test",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
