import { lexer, type Token, type Tokens } from "marked";
import { type ComponentChildren, h, type JSX } from "preact";
import { useMemo } from "preact/hooks";
import { highlightLines } from "../code/highlight.js";
import { classifyHref, dashboardHref } from "./links.js";

/**
 * Markdown → Preact. marked only tokenises; every node here is built as a vnode, so
 * memory text can never inject markup (the one `dangerouslySetInnerHTML` is fed by
 * Prism, which escapes its input). In-project links (`mem:`, `file:`, `sym:`) become
 * dashboard routes; web links open in a new tab.
 */

/** Fence labels people actually type → the Prism grammars bundled in highlight.ts. */
const LANGS: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  jsonc: "json",
  md: "markdown",
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

/** marked marks the few text tokens it has already HTML-escaped; undo that for text nodes. */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e in ENTITIES) return ENTITIES[e]!;
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return whole;
  });
}

function Inline({ tokens }: { tokens: Token[] | undefined }): JSX.Element {
  return <>{(tokens ?? []).map((t, i) => renderInline(t, i))}</>;
}

function Link({ t }: { t: Tokens.Link }): JSX.Element {
  const target = classifyHref(t.href);
  const label = <Inline tokens={t.tokens} />;
  const title = t.title ?? undefined;
  const local = dashboardHref(target);
  if (local)
    return (
      <a class="ref" href={local} title={title ?? t.href}>
        {label}
      </a>
    );
  if (target.kind === "external")
    return (
      <a href={target.href} title={title} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  if (target.kind === "anchor")
    return (
      <a href={target.href} title={title}>
        {label}
      </a>
    );
  return <span title={t.href}>{label}</span>;
}

function renderInline(t: Token, key: number): ComponentChildren {
  switch (t.type) {
    case "text": {
      const tt = t as Tokens.Text;
      if (tt.tokens) return <Inline key={key} tokens={tt.tokens} />;
      return tt.escaped ? decode(tt.text) : tt.text;
    }
    case "escape":
      return (t as Tokens.Escape).text;
    case "strong":
      return (
        <strong key={key}>
          <Inline tokens={(t as Tokens.Strong).tokens} />
        </strong>
      );
    case "em":
      return (
        <em key={key}>
          <Inline tokens={(t as Tokens.Em).tokens} />
        </em>
      );
    case "del":
      return (
        <del key={key}>
          <Inline tokens={(t as Tokens.Del).tokens} />
        </del>
      );
    case "codespan":
      return <code key={key}>{(t as Tokens.Codespan).text}</code>;
    case "br":
      return <br key={key} />;
    case "link":
      return <Link key={key} t={t as Tokens.Link} />;
    case "image": {
      const img = t as Tokens.Image;
      const target = classifyHref(img.href);
      return target.kind === "external" ? (
        <img
          key={key}
          src={target.href}
          alt={img.text}
          title={img.title ?? undefined}
          loading="lazy"
        />
      ) : (
        <span key={key} class="md-html" title={img.href}>
          {img.text}
        </span>
      );
    }
    case "checkbox":
      return <input key={key} type="checkbox" checked={(t as Tokens.Checkbox).checked} disabled />;
    case "html":
      // Raw HTML is shown, not interpreted: a memory is a note, not a page.
      return (
        <span key={key} class="md-html">
          {(t as Tokens.Tag).text}
        </span>
      );
    default: {
      const g = t as Tokens.Generic;
      return g.tokens ? <Inline key={key} tokens={g.tokens} /> : g.raw;
    }
  }
}

function CodeBlock({ t }: { t: Tokens.Code }): JSX.Element {
  const label = (t.lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const grammar = LANGS[label] ?? label;
  const html = useMemo(() => highlightLines(t.text, grammar).join("\n"), [t.text, grammar]);
  return (
    <pre class="code" data-lang={label || undefined}>
      {/* highlightLines escapes every line, with or without a grammar */}
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function Blocks({ tokens }: { tokens: Token[] | undefined }): JSX.Element {
  return <>{(tokens ?? []).map((t, i) => renderBlock(t, i))}</>;
}

function renderBlock(t: Token, key: number): ComponentChildren {
  switch (t.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const hd = t as Tokens.Heading;
      return h(`h${Math.min(Math.max(hd.depth, 1), 6)}`, { key }, <Inline tokens={hd.tokens} />);
    }
    case "paragraph":
      return (
        <p key={key}>
          <Inline tokens={(t as Tokens.Paragraph).tokens} />
        </p>
      );
    case "text": {
      // Block-level text: the body of a tight list item, rendered without a <p>.
      const tt = t as Tokens.Text;
      return tt.tokens ? <Inline key={key} tokens={tt.tokens} /> : tt.text;
    }
    case "checkbox":
      // A task item's box arrives as its own block token before the item text.
      return renderInline(t, key);
    case "code":
      return <CodeBlock key={key} t={t as Tokens.Code} />;
    case "blockquote":
      return (
        <blockquote key={key}>
          <Blocks tokens={(t as Tokens.Blockquote).tokens} />
        </blockquote>
      );
    case "list": {
      const list = t as Tokens.List;
      const items = list.items.map((it, i) => (
        <li key={i} class={it.task ? "task" : undefined}>
          <Blocks tokens={it.tokens} />
        </li>
      ));
      return list.ordered ? (
        <ol key={key} start={list.start === "" ? undefined : list.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "table": {
      const tb = t as Tokens.Table;
      const cell = (c: Tokens.TableCell, i: number) =>
        h(
          c.header ? "th" : "td",
          { key: i, style: c.align ? { textAlign: c.align } : undefined },
          <Inline tokens={c.tokens} />,
        );
      return (
        <table key={key}>
          <thead>
            <tr>{tb.header.map(cell)}</tr>
          </thead>
          <tbody>
            {tb.rows.map((r, i) => (
              <tr key={i}>{r.map(cell)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "hr":
      return <hr key={key} />;
    case "html":
      return (
        <pre key={key} class="md-html">
          {(t as Tokens.HTML).text}
        </pre>
      );
    default: {
      const g = t as Tokens.Generic;
      return <p key={key}>{g.tokens ? <Inline tokens={g.tokens} /> : g.raw}</p>;
    }
  }
}

export function Markdown({ source, class: cls }: { source: string; class?: string }): JSX.Element {
  const tokens = useMemo(() => lexer(source, { gfm: true }), [source]);
  return (
    <div class={cls ? `md ${cls}` : "md"}>
      <Blocks tokens={tokens} />
    </div>
  );
}
