// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Status } from "../../../src/types/api";
import { Pill } from "./ui/Pill";

interface HeaderProps {
  status: Status;
  onToggle: (enabled: boolean) => void;
  onLogout: () => void;
}

export function Header({ status, onToggle, onLogout }: HeaderProps) {
  const { instagram, facebook } = status.channels;
  const names = [
    instagram.connected && `@${instagram.name ?? instagram.id}`,
    facebook.connected && `Page ${facebook.name ?? facebook.id}`,
  ].filter(Boolean);
  const hasError = !!(instagram.tokenError || facebook.tokenError);
  const connection = names.length
    ? { text: `${names.join(" + ")} connected`, tone: hasError ? ("warn" as const) : ("ok" as const) }
    : { text: "Not connected", tone: "error" as const };
  return (
    <header class="header">
      <h1 class="header__brand">
        Open<span>DM</span>
      </h1>
      <Pill id="conn-pill" tone={connection.tone}>
        {connection.text}
      </Pill>
      <div class="spacer" />
      <label class="switch">
        <input
          type="checkbox"
          id="enabled"
          checked={status.enabled}
          onChange={(e) => onToggle(e.currentTarget.checked)}
        />
        <span id="enabled-label">{status.enabled ? "Automation on" : "Automation off"}</span>
      </label>
      <button type="button" class="btn btn--ghost" id="logout" onClick={onLogout}>
        Log out
      </button>
    </header>
  );
}
