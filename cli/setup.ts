// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// `opendm setup`: onboarding from the terminal. Every step also works non-interactively (flags, --json, exit codes)
// so an AI agent can drive it, and every step is safe to run again.
import { createInterface } from "node:readline/promises";
import type { OpenDmClient } from "../src/mcp/client.ts";
import type { SetupReport } from "../src/types/api.ts";
import { type FlagValues, stringOf } from "./args.ts";
import type { CommandResult } from "./commands.ts";

const OK = 0;
const NEEDS_HUMAN = 2;

export const SETUP_HELP = `opendm setup - get from zero to live

  opendm setup                       interactive walkthrough (in a terminal); prints the checklist otherwise
  opendm setup status                the checklist, the next step and whether a person must act (exit 2 if so)
  opendm setup checks                live checks against Meta (tokens, webhook subscription, events)
  opendm setup credentials --platform instagram|facebook --app-id ID [--app-secret SECRET]
  opendm setup oauth-url --platform instagram|facebook
  opendm setup exchange --platform instagram|facebook --token TOKEN
  opendm setup facebook --token TOKEN [--page-id ID]     connect a Page (Page token, or user token + Page)
  opendm setup subscribe [--platform facebook]
  opendm setup test [--comment TEXT]                     checks + a dry run, sends nothing

Non-interactive: pass flags, add --json for machine output. The app secret can also come from OPENDM_APP_SECRET.`;

const mark = { ok: "[x]", todo: "[ ]", warn: "[!]", info: "[i]" } as const;

function renderReport(report: SetupReport): string {
  const lines = report.steps.map((s) => `${mark[s.status]} ${s.title}: ${s.detail}`);
  if (report.ready) return `${lines.join("\n")}\n\nSetup is complete.`;
  const next = report.next;
  const human = next?.needsHuman ? "\n  A person has to do this step." : "";
  return `${lines.join("\n")}\n\nNEXT: ${next?.title}\n  ${next?.help ?? ""}${human}`;
}

const reportResult = (report: SetupReport): CommandResult => ({
  text: renderReport(report),
  json: report,
  exitCode: report.ready || !report.next?.needsHuman ? OK : NEEDS_HUMAN,
});

const platformOf = (v: FlagValues) => (v.platform === "facebook" ? "facebook" : "instagram");

export async function runSetup(args: string[], values: FlagValues, client: OpenDmClient): Promise<CommandResult> {
  const [action] = args;
  switch (action) {
    case "help":
      return { text: SETUP_HELP, json: { help: SETUP_HELP }, exitCode: OK };
    case "status":
      return reportResult(await client.setupReport());
    case "checks": {
      const checks = await client.setupChecks();
      return {
        text: checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`).join("\n"),
        json: { checks },
        exitCode: checks.every((c) => c.ok) ? OK : NEEDS_HUMAN,
      };
    }
    case "credentials": {
      const appId = stringOf(values["app-id"]);
      if (!appId) throw new Error("--app-id is required");
      const platform = platformOf(values);
      await client.setAppCredentials(platform, appId, stringOf(values["app-secret"]) ?? process.env.OPENDM_APP_SECRET);
      return { text: `Saved the ${platform} app credentials.`, json: { ok: true, platform }, exitCode: OK };
    }
    case "oauth-url": {
      const { url } = await client.oauthUrl(platformOf(values));
      return {
        text: `Open this URL in the browser where you are logged in to the dashboard:\n${url}`,
        json: { url },
        exitCode: NEEDS_HUMAN,
      };
    }
    case "exchange": {
      const token = stringOf(values.token);
      if (!token) throw new Error("--token is required");
      const { message } = await client.exchangeToken(platformOf(values), token);
      return { text: message, json: { ok: true, message }, exitCode: OK };
    }
    case "facebook": {
      const token = stringOf(values.token);
      if (!token) throw new Error("--token is required");
      const result = await client.connectFacebook(token, stringOf(values["page-id"]));
      if (result.connected) return { text: `Connected Facebook Page ${result.page.name}.`, json: result, exitCode: OK };
      const pages = result.pages.map((p) => `  ${p.id} ${p.name}`).join("\n");
      return { text: `Choose a Page and run again with --page-id:\n${pages}`, json: result, exitCode: NEEDS_HUMAN };
    }
    case "subscribe": {
      const platform = platformOf(values);
      await client.subscribe(platform);
      return { text: `Subscribed ${platform} to its webhooks.`, json: { ok: true, platform }, exitCode: OK };
    }
    case "test": {
      const checks = await client.setupChecks();
      const rules = await client.listRules();
      const comment = stringOf(values.comment) ?? rules[0]?.keywords[0];
      const dry = comment ? await client.dryRun({ comment, replies: ["yes", "done"], following: "yes" }) : null;
      const text = [
        ...checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`),
        dry
          ? `dry run of "${comment}": ${dry.matched ? `matched, ends at ${dry.finalStep}` : "no rule matched"}`
          : "no rule to dry-run yet",
      ].join("\n");
      return { text, json: { checks, dryRun: dry }, exitCode: checks.every((c) => c.ok) ? OK : NEEDS_HUMAN };
    }
    case undefined:
      return process.stdin.isTTY && !values.json && !values.yes
        ? interactive(client)
        : reportResult(await client.setupReport());
    default:
      throw new Error(`Unknown setup command "${action}". Run: opendm setup help`);
  }
}

/** The walkthrough: shows the checklist, then asks for what the next step needs. */
async function interactive(client: OpenDmClient): Promise<CommandResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const say = (text: string) => process.stdout.write(`${text}\n`);
  try {
    for (let round = 0; round < 12; round++) {
      const report = await client.setupReport();
      say(`\n${renderReport(report)}\n`);
      if (report.ready || !report.next) break;
      const step = report.next.id;
      if (step === "app") {
        const platform =
          (await rl.question("Platform (instagram/facebook) [instagram]: ")).trim() === "facebook"
            ? "facebook"
            : "instagram";
        say(
          "Create the app at https://developers.facebook.com/apps (type Business, add the Instagram product), then copy its App ID and App secret.",
        );
        const appId = (await rl.question("App ID: ")).trim();
        const secret = (await rl.question("App secret (will be stored encrypted): ")).trim();
        if (appId) await client.setAppCredentials(platform, appId, secret || undefined);
      } else if (step === "connect" || step === "token") {
        const platform =
          (await rl.question("Connect which platform? (instagram/facebook) [instagram]: ")).trim() === "facebook"
            ? "facebook"
            : "instagram";
        try {
          say(`Open this URL (logged in to the dashboard in that browser): ${(await client.oauthUrl(platform)).url}`);
        } catch {
          say("OAuth needs the app ID saved first.");
        }
        const token = (await rl.question("Or paste an access token (Enter to skip, then re-run): ")).trim();
        if (token) say((await client.exchangeToken(platform, token)).message);
        else await rl.question("Press Enter after authorizing in the browser: ");
      } else if (step === "webhook") {
        const status = await client.status();
        say(
          `In the Meta app set Callback URL ${status.webhookUrl} and your VERIFY_TOKEN, subscribe to comments and messages (feed for Facebook).`,
        );
        await rl.question("Press Enter when saved: ");
        for (const platform of ["instagram", "facebook"] as const) {
          if (status.channels[platform].connected)
            say(
              `${platform}: ${await client
                .subscribe(platform)
                .then(() => "subscribed")
                .catch((e: Error) => e.message)}`,
            );
        }
      } else {
        say(`${report.next.help ?? ""}\nDo that, then press Enter to re-check (Ctrl+C to stop).`);
        await rl.question("");
      }
    }
  } finally {
    rl.close();
  }
  return reportResult(await client.setupReport());
}
