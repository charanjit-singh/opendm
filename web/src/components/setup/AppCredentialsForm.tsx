// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { Platform } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { SelectField, TextField } from "../ui/Field";
import { createAppSteps, META_APPS_URL } from "./guide";

export function AppCredentialsForm({ notify, refresh, redirectUri }: TabProps & { redirectUri: string }) {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");

  const save = () =>
    api
      .saveCredentials(platform, appId.trim(), secret.trim() || undefined)
      .then(() => {
        setSecret("");
        notify(`Saved the ${platform} app credentials`);
        return refresh();
      })
      .catch((e) => notify(errorMessage(e), "error"));

  return (
    <>
      <details>
        <summary>How to create the Meta app</summary>
        <ol class="guide">
          {createAppSteps(redirectUri).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
        <p class="hint">
          <a href={META_APPS_URL} target="_blank" rel="noreferrer">
            Open Meta for Developers
          </a>
        </p>
      </details>
      <div class="row">
        <SelectField
          id="app-platform"
          label="Platform"
          value={platform}
          options={[
            ["instagram", "Instagram (Instagram Login)"],
            ["facebook", "Facebook (Pages and Facebook Login)"],
          ]}
          onChange={(value) => setPlatform(value as Platform)}
        />
        <TextField id="app-id" label="App ID" value={appId} onInput={setAppId} />
        <TextField
          id="app-secret"
          type="password"
          label="App secret (stored encrypted)"
          value={secret}
          onInput={setSecret}
        />
      </div>
      <p>
        <button type="button" class="btn" id="save-credentials" onClick={save}>
          Save credentials
        </button>
      </p>
    </>
  );
}
