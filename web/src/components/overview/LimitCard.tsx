// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { Status } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { Card } from "../ui/Card";
import { TextField } from "../ui/Field";

export function LimitCard({ status, refresh, notify }: TabProps & { status: Status }) {
  const [value, setValue] = useState(String(status.hourlyLimit));
  const save = () =>
    api
      .setHourlyLimit(Number(value))
      .then(() => {
        notify("Limit saved");
        return refresh();
      })
      .catch((e) => notify(errorMessage(e), "error"));

  return (
    <Card title="Sending limit">
      <p class="hint">
        Messages beyond this many per rolling hour wait in a queue and go out as the hour frees up. Sent in the last
        hour: {status.sentLastHour}.
      </p>
      <div class="row row--end">
        <TextField id="hourly" type="number" min={1} max={5000} label="Max sends per hour" value={value} onInput={setValue} />
        <div>
          <button type="button" class="btn btn--ghost" id="save-limit" onClick={save}>
            Save limit
          </button>
        </div>
      </div>
    </Card>
  );
}
