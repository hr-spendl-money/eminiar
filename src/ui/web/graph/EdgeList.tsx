import type { JSX } from "preact";
import { Tag } from "../components.js";

/** One side of a selected node's edges (incoming or outgoing) as a clickable table. */
export function EdgeList({
  title,
  rows,
  label,
  onPick,
  max = 60,
}: {
  title: string;
  rows: Array<{ kind: string; id: string }>;
  label: (id: string) => string;
  onPick: (id: string) => void;
  max?: number;
}): JSX.Element {
  return (
    <div class="section">
      <h4>
        {title} · {rows.length}
      </h4>
      <table>
        <tbody>
          {rows.slice(0, max).map((r) => (
            <tr class="click" onClick={() => onPick(r.id)}>
              <td>
                <Tag>{r.kind}</Tag>
              </td>
              <td class="break">{label(r.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max ? <div class="muted small">… {rows.length - max} more</div> : null}
    </div>
  );
}
