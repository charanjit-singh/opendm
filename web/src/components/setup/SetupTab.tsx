// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useEffect, useState } from "preact/hooks";
import type { SetupCheck, SetupReport, Status } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { Card } from "../ui/Card";
import { AppCredentialsForm } from "./AppCredentialsForm";
import { ConnectPanel } from "./ConnectPanel";
import { reviewNotes, webhookSteps } from "./guide";
import { StepCard } from "./StepCard";

interface SetupTabProps extends TabProps {
  status: Status;
  goTo: (tab: "rules" | "log") => void;
}

/** First-run wizard: every step shows a live status and can be re-run at any time. */
export function SetupTab({ status, refresh, notify, goTo }: SetupTabProps) {
  const [report, setReport] = useState<SetupReport | null>(null);
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const redirectUri = `${location.origin}/admin/oauth/callback`;

  const load = () =>
    api
      .setup()
      .then(setReport)
      .catch((e) => notify(errorMessage(e), "error"));
  useEffect(() => void load(), []);

  const reload = async () => {
    await refresh();
    await load();
  };
  const runChecks = () =>
    api
      .setupChecks()
      .then((r) => setChecks(r.checks))
      .then(load)
      .catch((e) => notify(errorMessage(e), "error"));
  const subscribe = (platform: "instagram" | "facebook") =>
    api
      .subscribe(platform)
      .then(() => {
        notify(`Subscribed ${platform} to its webhooks`);
        return reload();
      })
      .catch((e) => notify(errorMessage(e), "error"));

  if (!report) return null;
  const tabProps = { refresh: reload, notify };

  return (
    <section id="setup">
      <Card>
        <h2 class="card__title">Setup</h2>
        <p class="hint">
          {report.ready ? "Everything is in place." : `Next: ${report.next?.title}.`} Each step can be run again at any
          time. The same checklist is available from the CLI (<code>opendm setup</code>) and to Claude over MCP.
        </p>
        <p>
          <button type="button" class="btn btn--ghost" id="setup-recheck" onClick={reload}>
            Re-check
          </button>{" "}
          <button type="button" class="btn btn--ghost" id="setup-live-checks" onClick={runChecks}>
            Run live checks
          </button>
        </p>
        {checks && (
          <ul class="checks" id="setup-checks">
            {checks.map((check) => (
              <li key={check.name} class={check.ok ? "checks__ok" : "checks__fail"}>
                {check.ok ? "✓" : "✗"} {check.name}: {check.detail}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {report.steps.map((step, i) => (
        <StepCard key={step.id} step={step} index={i + 1}>
          {step.id === "app" && <AppCredentialsForm {...tabProps} redirectUri={redirectUri} />}
          {step.id === "connect" && (
            <>
              <ConnectPanel platform="instagram" status={status} {...tabProps} />
              <ConnectPanel platform="facebook" status={status} {...tabProps} />
            </>
          )}
          {step.id === "webhook" && (
            <>
              <ol class="guide">
                {webhookSteps(status.webhookUrl).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
              <p class="field__label">Callback URL</p>
              <div class="mono" id="setup-callback">
                {status.webhookUrl}
              </div>
              <p class="field__label">Verify token</p>
              <div class="mono" id="setup-verify-token">
                {revealed ? status.verifyToken : "••••••••••••"}
              </div>{" "}
              <button type="button" class="btn btn--ghost" id="reveal-token" onClick={() => setRevealed(!revealed)}>
                {revealed ? "Hide" : "Show"}
              </button>
              <p>
                {(["instagram", "facebook"] as const)
                  .filter((p) => status.channels[p].connected)
                  .map((p) => (
                    <button key={p} type="button" class="btn" id={`setup-subscribe-${p}`} onClick={() => subscribe(p)}>
                      Subscribe {p}
                    </button>
                  ))}
              </p>
            </>
          )}
          {step.id === "rule" && !(step.status === "ok") && (
            <p>
              <button type="button" class="btn" id="setup-go-rules" onClick={() => goTo("rules")}>
                Create a rule
              </button>
            </p>
          )}
          {step.id === "comment" && (
            <p>
              <button type="button" class="btn btn--ghost" onClick={() => goTo("log")}>
                Open the log
              </button>
            </p>
          )}
          {step.id === "review" && (
            <ul class="guide">
              {reviewNotes.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </StepCard>
      ))}
    </section>
  );
}
