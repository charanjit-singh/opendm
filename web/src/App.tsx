// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useEffect, useState } from "preact/hooks";
import type { Status } from "../../src/types/api";
import { api, onUnauthorized } from "./api";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { LoginForm } from "./components/LoginForm";
import { LogTab } from "./components/log/LogTab";
import { OverviewTab } from "./components/overview/OverviewTab";
import { RulesTab } from "./components/rules/RulesTab";
import { SetupTab } from "./components/setup/SetupTab";
import { DryRunTab } from "./components/test/DryRunTab";
import { Notice } from "./components/ui/Notice";

type Session = "checking" | "signed-out" | "signed-in";
type TabId = "setup" | "overview" | "rules" | "test" | "log";

const TABS: [TabId, string][] = [
  ["setup", "Setup"],
  ["overview", "Overview"],
  ["rules", "Rules"],
  ["test", "Test"],
  ["log", "Log"],
];

const FLASH_MS = 5000;

export interface Flash {
  text: string;
  kind: "ok" | "error";
}

/** Instagram's OAuth redirect comes back to /admin#<message>; show it once. */
function takeHashMessage(): Flash | null {
  if (location.hash.length <= 1) return null;
  const text = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, "", "/admin");
  return { text, kind: /fail|invalid|could not|said/i.test(text) ? "error" : "ok" };
}

export function App() {
  const [session, setSession] = useState<Session>("checking");
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [flash, setFlash] = useState<Flash | null>(null);

  const notify = (text: string, kind: Flash["kind"] = "ok") => setFlash({ text, kind });
  const refreshStatus = () =>
    api
      .status()
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    onUnauthorized(() => setSession("signed-out"));
    api
      .status()
      .then((s) => {
        setStatus(s);
        setSession("signed-in");
        // First run: nothing connected yet, so start in the setup wizard.
        if (!s.channels.instagram.connected && !s.channels.facebook.connected) setTab("setup");
        const message = takeHashMessage();
        if (message) setFlash(message);
      })
      .catch(() => setSession("signed-out"));
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  if (session === "checking") return null;
  if (session === "signed-out") {
    return (
      <LoginForm
        onLoggedIn={() =>
          api.status().then((s) => {
            setStatus(s);
            setSession("signed-in");
          })
        }
      />
    );
  }
  if (!status) return null;

  return (
    <div id="app">
      <Header
        status={status}
        onToggle={(enabled) => api.setEnabled(enabled).then(refreshStatus)}
        onLogout={() => api.logout().then(() => setSession("signed-out"))}
      />
      <main class="page">
        <nav class="tabs" id="tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-tab={id}
              class={tab === id ? "tab tab--active" : "tab"}
              onClick={() => {
                setFlash(null);
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {flash && (
          <Notice kind={flash.kind} id="flash">
            {flash.text}
          </Notice>
        )}
        {tab === "setup" && <SetupTab status={status} refresh={refreshStatus} notify={notify} goTo={setTab} />}
        {tab === "overview" && (
          <OverviewTab status={status} refresh={refreshStatus} notify={notify} openSetup={() => setTab("setup")} />
        )}
        {tab === "rules" && <RulesTab status={status} refresh={refreshStatus} notify={notify} />}
        {tab === "test" && <DryRunTab notify={notify} />}
        {tab === "log" && <LogTab notify={notify} />}
      </main>
      <Footer />
    </div>
  );
}
