// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Env as WorkerEnv } from "./env";

// Lets `import { env } from "cloudflare:test"` in the tests see our bindings.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
