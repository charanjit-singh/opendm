// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { Platform, Status } from "../../../../src/types/api";
import { api, type PageInfo } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { TextField } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { FACEBOOK_PERMISSIONS, INSTAGRAM_PERMISSIONS, INSTAGRAM_VIA_FACEBOOK_PERMISSIONS } from "./guide";

interface ConnectPanelProps extends TabProps {
  platform: Platform;
  status: Status;
}

const LABEL = { instagram: "Instagram", facebook: "Facebook Page" } as const;

/** Connect one platform: the OAuth button when the app ID is saved, or paste a token. Facebook may ask which Page. */
export function ConnectPanel({ platform, status, refresh, notify }: ConnectPanelProps) {
  const channel = status.channels[platform];
  const [token, setToken] = useState("");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const oauthReady = platform === "instagram" ? status.oauthAvailable : status.facebookOauthAvailable;
  const permissions =
    platform === "instagram" ? INSTAGRAM_PERMISSIONS : [...FACEBOOK_PERMISSIONS, ...INSTAGRAM_VIA_FACEBOOK_PERMISSIONS];

  const connect = async () => {
    setError(null);
    try {
      if (platform === "instagram") {
        await api.connect(token);
      } else {
        const result = await api.connectFacebook(token);
        if (!result.connected) {
          setPages(result.pages);
          return;
        }
      }
      setToken("");
      notify(`${LABEL[platform]} connected`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const choose = async (pageId: string) => {
    try {
      await api.selectFacebookPage(pageId);
      setPages([]);
      notify("Facebook Page connected");
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div class="connect" id={`connect-${platform}`}>
      <h3 class="connect__title">{LABEL[platform]}</h3>
      {channel.connected ? (
        <p>
          Connected as <b>{channel.name ?? channel.id}</b> <span class="hint">({channel.mode?.replace("_", " ")})</span>
        </p>
      ) : (
        <>
          {oauthReady ? (
            <p>
              <a class="btn" id={`oauth-${platform}`} href={`/admin/oauth/start?platform=${platform}`}>
                Connect with {platform === "instagram" ? "Instagram" : "Facebook"}
              </a>
            </p>
          ) : (
            <p class="hint">Save the app ID and secret above to enable the one-click button, or paste a token.</p>
          )}
          <details>
            <summary>Paste a token instead</summary>
            <p class="hint">Permissions needed: {permissions.join(", ")}</p>
            <TextField
              id={`token-${platform}`}
              type="password"
              label={platform === "instagram" ? "Instagram access token" : "Page or user access token"}
              value={token}
              onInput={setToken}
            />
            <p>
              <button type="button" class="btn" id={`connect-${platform}-btn`} onClick={connect}>
                Connect
              </button>
            </p>
          </details>
        </>
      )}
      {pages.length > 0 && (
        <div id="page-chooser">
          <p class="hint">Choose the Page to connect:</p>
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              class="btn btn--ghost"
              data-page={page.id}
              onClick={() => choose(page.id)}
            >
              {page.name}
              {page.instagram ? ` (+ @${page.instagram.username ?? page.instagram.id})` : ""}
            </button>
          ))}
        </div>
      )}
      {error && (
        <Notice kind="error" id={`connect-${platform}-err`}>
          {error}
        </Notice>
      )}
    </div>
  );
}
