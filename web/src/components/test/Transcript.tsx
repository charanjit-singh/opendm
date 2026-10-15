// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { TranscriptLine } from "../../../../src/types/api";

export function Transcript({ lines }: { lines: TranscriptLine[] }) {
  return (
    <div class="chat" id="t-chat">
      {lines.map((line, index) => (
        <div key={index} class={`bubble bubble--${line.from}`}>
          {line.text}
          {line.note && <small class="bubble__note">{line.note}</small>}
        </div>
      ))}
    </div>
  );
}
