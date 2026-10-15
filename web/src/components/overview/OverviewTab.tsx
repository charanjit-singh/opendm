// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Status } from "../../../../src/types/api";
import type { TabProps } from "../tab-props";
import { AccountCard } from "./AccountCard";
import { LimitCard } from "./LimitCard";
import { StatsGrid } from "./StatsGrid";
import { WebhookCard } from "./WebhookCard";

export function OverviewTab({
  status,
  refresh,
  notify,
  openSetup,
}: TabProps & { status: Status; openSetup: () => void }) {
  return (
    <section>
      <StatsGrid status={status} />
      <AccountCard platform="instagram" status={status} refresh={refresh} notify={notify} openSetup={openSetup} />
      <AccountCard platform="facebook" status={status} refresh={refresh} notify={notify} openSetup={openSetup} />
      <WebhookCard webhookUrl={status.webhookUrl} />
      <LimitCard status={status} refresh={refresh} notify={notify} />
    </section>
  );
}
