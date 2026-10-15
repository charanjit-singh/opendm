// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Status } from "../../../../src/types/api";
import type { TabProps } from "../tab-props";
import { AccountCard } from "./AccountCard";
import { LimitCard } from "./LimitCard";
import { StatsGrid } from "./StatsGrid";
import { WebhookCard } from "./WebhookCard";

export function OverviewTab({ status, refresh, notify }: TabProps & { status: Status }) {
  return (
    <section>
      <StatsGrid status={status} />
      <AccountCard status={status} refresh={refresh} notify={notify} />
      <WebhookCard webhookUrl={status.webhookUrl} />
      <LimitCard status={status} refresh={refresh} notify={notify} />
    </section>
  );
}
