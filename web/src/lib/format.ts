// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.

/** "5m ago", "3h ago". */
export function timeAgo(timestampMs: number, now = Date.now()): string {
  const seconds = Math.round((now - timestampMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
