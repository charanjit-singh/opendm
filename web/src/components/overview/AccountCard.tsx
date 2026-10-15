// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Platform, Status } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { Card } from "../ui/Card";
import { Notice } from "../ui/Notice";

interface AccountCardProps extends TabProps {
  platform: Platform;
  status: Status;
  openSetup: () => void;
}

const TITLE = { instagram: "Instagram account", facebook: "Facebook Page" } as const;

/** Where a platform stands: connected as whom, token problems, subscribe and disconnect. Connecting happens in Setup. */
export function AccountCard({ platform, status, refresh, notify, openSetup }: AccountCardProps) {
  const channel = status.channels[platform];
  const subscribe = () =>
    api
      .subscribe(platform)
      .then(() => notify(`Subscribed ${platform} to its webhooks`))
      .catch((e) => notify(errorMessage(e), "error"));
  const disconnect = () => {
    if (confirm(`Disconnect ${platform}?`)) api.disconnect(platform).then(refresh);
  };

  return (
    <Card title={TITLE[platform]} id={`account-${platform}`}>
      {channel.connected ? (
        <>
          <p>
            Connected as <b>{platform === "instagram" ? `@${channel.name}` : channel.name}</b>{" "}
            <span class="hint">
              (id {channel.id}, {channel.mode?.replace("_", " ")})
            </span>
          </p>
          {channel.tokenError && <Notice kind="error">Token problem: {channel.tokenError} Reconnect in Setup.</Notice>}
          {platform === "instagram" && status.tokenExpires && (
            <p class="hint">
              Token expires {new Date(status.tokenExpires).toLocaleDateString()} (refreshed automatically).
            </p>
          )}
          <p>
            <button type="button" class="btn" id={`subscribe-${platform}`} onClick={subscribe}>
              Subscribe to webhooks
            </button>{" "}
            <button type="button" class="btn btn--danger" id={`disconnect-${platform}`} onClick={disconnect}>
              Disconnect
            </button>
          </p>
        </>
      ) : (
        <p>
          <span class="hint">Not connected. </span>
          <button type="button" class="btn btn--ghost" id={`open-setup-${platform}`} onClick={openSetup}>
            Open setup
          </button>
        </p>
      )}
    </Card>
  );
}
