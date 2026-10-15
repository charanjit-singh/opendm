// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { Status } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { Card } from "../ui/Card";
import { TextField } from "../ui/Field";
import { Notice } from "../ui/Notice";

export function AccountCard({ status, refresh, notify }: TabProps & { status: Status }) {
  return (
    <Card title="Instagram account">
      {status.connected ? <Connected status={status} refresh={refresh} notify={notify} /> : <ConnectForm status={status} refresh={refresh} notify={notify} />}
    </Card>
  );
}

function Connected({ status, refresh, notify }: TabProps & { status: Status }) {
  const subscribe = () =>
    api
      .subscribe()
      .then(() => notify("Subscribed to comments and messages"))
      .catch((e) => notify(errorMessage(e), "error"));
  const disconnect = () => {
    if (confirm("Disconnect this account?")) api.disconnect().then(refresh);
  };
  return (
    <>
      <p>
        Connected as <b>@{status.username}</b> <span class="hint">(id {status.igId})</span>
      </p>
      {status.tokenError && <Notice kind="error">Token problem: {status.tokenError} Reconnect below.</Notice>}
      {status.tokenExpires && (
        <p class="hint">Token expires {new Date(status.tokenExpires).toLocaleDateString()} (refreshed automatically).</p>
      )}
      <p>
        <button type="button" class="btn" id="subscribe" onClick={subscribe}>
          Subscribe to comments + messages
        </button>{" "}
        <button type="button" class="btn btn--danger" id="disconnect" onClick={disconnect}>
          Disconnect
        </button>
      </p>
    </>
  );
}

function ConnectForm({ status, refresh, notify }: TabProps & { status: Status }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.connect(token);
      notify("Account connected");
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      {status.oauthAvailable ? (
        <>
          <p>
            <a class="btn" id="oauth" href="/admin/oauth/start">
              Connect with Instagram
            </a>
          </p>
          <p class="hint">or paste a token:</p>
        </>
      ) : (
        <p class="hint">Paste an Instagram user access token (Meta app, Instagram Login, API setup, Generate token).</p>
      )}
      <TextField id="token" type="password" label="Access token" placeholder="IGAA..." value={token} onInput={setToken} />
      <p>
        <button type="button" class="btn" id="connect" disabled={busy} onClick={connect}>
          Connect
        </button>
      </p>
      {error && <Notice kind="error" id="connect-err">{error}</Notice>}
    </>
  );
}
