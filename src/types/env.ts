// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
export interface Env {
  DB: D1Database;
  /** Secrets (set with `wrangler secret put`, or prompted by the Deploy button). */
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  VERIFY_TOKEN: string;
  INSTAGRAM_APP_SECRET: string;
  /** Static assets binding (the dashboard build in dist/client). */
  ASSETS?: Fetcher;
  /** Optional: needed only for the "Connect with Instagram" OAuth button. */
  INSTAGRAM_APP_ID?: string;
  /** Overrides for tests / the local e2e mock (default https://graph.instagram.com). */
  GRAPH_BASE?: string;
  OAUTH_BASE?: string;
}
