// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { DryRunResult } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { Flash } from "../../App";
import { Card } from "../ui/Card";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { Transcript } from "./Transcript";

export function DryRunTab({ notify }: { notify: (text: string, kind?: Flash["kind"]) => void }) {
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [replies, setReplies] = useState("");
  const [following, setFollowing] = useState("unknown");
  const [wait, setWait] = useState("");
  const [result, setResult] = useState<DryRunResult | null>(null);

  const run = () =>
    api
      .dryRun({ comment, name, replies, following: following as "yes" | "no" | "unknown", waitMinutes: Number(wait) || 0 })
      .then(setResult)
      .catch((e) => notify(errorMessage(e), "error"));

  return (
    <Card title="Dry run">
      <p class="hint">Type a comment and see exactly what the bot would send. Nothing is sent to Instagram.</p>
      <div class="row">
        <TextField id="t-comment" label="Comment" placeholder="GUIDE please" value={comment} onInput={setComment} />
        <TextField id="t-name" label="First name (optional)" placeholder="Sam" value={name} onInput={setName} />
      </div>
      <TextAreaField id="t-replies" label="What the person replies next (one per line)" placeholder={"yes\ndone\nme@example.com"} value={replies} onInput={setReplies} />
      <div class="row">
        <SelectField
          id="t-following"
          label="Follow check result"
          value={following}
          options={[
            ["unknown", "Unknown (Meta can't tell)"],
            ["yes", "They follow"],
            ["no", "They don't follow"],
          ]}
          onChange={setFollowing}
        />
        <TextField id="t-wait" type="number" min={0} label="Then wait (minutes, no reply)" placeholder="0" value={wait} onInput={setWait} />
      </div>
      <p>
        <button type="button" class="btn" id="t-run" onClick={run}>
          Run test
        </button>
      </p>
      <div id="t-out">
        {result && (
          <>
            {result.matched ? (
              <Notice kind="ok" id="t-matched">
                Matched rule: <b>{result.rule.name}</b>. Conversation ends at step: <b>{result.finalStep}</b>
              </Notice>
            ) : (
              <Notice kind="error" id="t-matched">
                No rule matched
              </Notice>
            )}
            <Transcript lines={result.transcript} />
          </>
        )}
      </div>
    </Card>
  );
}
