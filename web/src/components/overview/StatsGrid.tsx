// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Status } from "../../../../src/types/api";
import { Stat } from "../ui/Stat";

export function StatsGrid({ status }: { status: Status }) {
  const steps = status.conversations;
  const waiting = (steps.opened ?? 0) + (steps.awaiting_follow ?? 0) + (steps.awaiting_email ?? 0);
  return (
    <div class="grid" id="stats">
      <Stat label="Rules" value={status.rules} />
      <Stat label="Messages sent (24h)" value={status.sent24h} />
      <Stat label="Sent this hour" value={`${status.sentLastHour} / ${status.hourlyLimit}`} />
      <Stat label="Waiting on a reply" value={waiting} />
      <Stat label="Finished" value={steps.done ?? 0} />
    </div>
  );
}
