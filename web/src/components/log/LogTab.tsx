// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useEffect, useState } from "preact/hooks";
import type { EventRow, EventStatus } from "../../../../src/types/api";
import type { Flash } from "../../App";
import { api } from "../../api";
import { errorMessage, timeAgo } from "../../lib/format";
import { Card } from "../ui/Card";
import { Pill } from "../ui/Pill";

const STATUS_TONE: Partial<Record<EventStatus, "ok" | "warn" | "error">> = {
  sent: "ok",
  queued: "warn",
  error: "error",
};

export function LogTab({ notify }: { notify: (text: string, kind?: Flash["kind"]) => void }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const load = () =>
    api
      .log()
      .then((d) => setEvents(d.events))
      .catch((e) => notify(errorMessage(e), "error"));
  useEffect(() => void load(), []);

  return (
    <Card>
      <div class="row row--center">
        <h2 class="card__title card__title--flush">Event log</h2>
        <div class="align-right">
          <button type="button" class="btn btn--ghost" id="log-refresh" onClick={load}>
            Refresh
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Platform</th>
              <th>Type</th>
              <th>Status</th>
              <th>Who</th>
              <th>Keyword</th>
              <th>Wording</th>
              <th>Text / detail</th>
            </tr>
          </thead>
          <tbody id="log-body">
            {events.length === 0 && (
              <tr>
                <td colSpan={8} class="hint">
                  No events yet.
                </td>
              </tr>
            )}
            {events.map((event) => (
              <tr key={event.id}>
                <td title={new Date(event.ts).toISOString()}>{timeAgo(event.ts)}</td>
                <td>{event.platform ?? ""}</td>
                <td>{event.kind}</td>
                <td>
                  <Pill tone={STATUS_TONE[event.status]}>{event.status}</Pill>
                </td>
                <td>{event.username ? `@${event.username}` : (event.ig_user ?? "")}</td>
                <td>{event.keyword ?? ""}</td>
                <td>{event.variant ?? ""}</td>
                <td class="table__wrap">
                  {event.text}
                  {event.error && (
                    <>
                      <br />
                      <span class="hint">{event.error}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
