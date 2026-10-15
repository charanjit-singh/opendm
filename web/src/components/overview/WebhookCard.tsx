// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Card } from "../ui/Card";

export function WebhookCard({ webhookUrl }: { webhookUrl: string }) {
  return (
    <Card title="Webhook">
      <p class="hint">
        In your Meta app (Instagram Login, Webhooks) use these two values, then subscribe to <b>comments</b> and{" "}
        <b>messages</b>.
      </p>
      <p class="field__label">Callback URL</p>
      <div class="mono" id="webhook-url">
        {webhookUrl}
      </div>
      <p class="field__label">Verify token</p>
      <div class="hint">
        The <code>VERIFY_TOKEN</code> secret you set when deploying.
      </div>
    </Card>
  );
}
