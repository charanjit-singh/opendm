// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import { api } from "../api";
import { errorMessage } from "../lib/format";
import { Card } from "./ui/Card";
import { TextField } from "./ui/Field";
import { Notice } from "./ui/Notice";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(password);
      setPassword("");
      onLoggedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login" id="login">
      <Card>
        <h1 class="header__brand">
          Open<span>DM</span>
        </h1>
        <p class="hint">Admin login</p>
        <form onSubmit={submit}>
          <TextField id="password" type="password" label="Password" value={password} onInput={setPassword} />
          {error && (
            <Notice kind="error" id="login-err">
              {error}
            </Notice>
          )}
          <p>
            <button class="btn" id="login-btn" type="submit" disabled={busy}>
              Log in
            </button>
          </p>
        </form>
      </Card>
    </div>
  );
}
