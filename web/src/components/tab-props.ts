// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.

/** What every tab gets from the app shell. */
export interface TabProps {
  notify: (text: string, kind?: "ok" | "error") => void;
  refresh: () => Promise<void>;
}
