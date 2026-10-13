import { describe, expect, it } from "vitest";
import { chunk, sniffKind } from "../../src/chunker/index.js";
import { chunkJson } from "../../src/chunker/json.js";
import { chunkMarkdown } from "../../src/chunker/markdown.js";

describe("chunkMarkdown", () => {
  it("splits by heading path and ignores headings inside fences", () => {
    const md = `# Title
intro

## Install
\`\`\`sh
# not a heading
npm i
\`\`\`

### macOS
brew it

## Usage
run it`;
    const out = chunkMarkdown(md, "README.md");
    expect(out.map((c) => c.title)).toEqual([
      "README.md > Title",
      "README.md > Title > Install",
      "README.md > Title > Install > macOS",
      "README.md > Title > Usage",
    ]);
    expect(out[1]!.body).toContain("# not a heading");
    // a section starts at its heading line
    expect(out[2]!.startLine).toBe(10);
  });

  it("windows oversized sections on blank lines", () => {
    const para = "lorem ipsum dolor sit amet ".repeat(20);
    const md = `# Big\n${[para, para, para, para].join("\n\n")}`;
    const out = chunkMarkdown(md, "big.md", { maxChars: 1200, overlapLines: 0 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.body.length).toBeLessThanOrEqual(1300);
    expect(out[0]!.title).toMatch(/Big \(L\d+-\d+\)/);
  });
});

describe("chunkJson", () => {
  it("chunks by key path and groups arrays", () => {
    const data = {
      name: "x",
      deps: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`pkg${i}`, `^${i}.0.0`])),
      list: Array.from({ length: 50 }, (_, i) => ({ id: i, text: "y".repeat(100) })),
    };
    const out = chunkJson(JSON.stringify(data), "package.json", {
      maxChars: 1000,
      overlapLines: 0,
    });
    expect(out.some((c) => c.title.includes("$.name"))).toBe(true);
    expect(out.some((c) => c.title.includes("$.deps"))).toBe(true);
    expect(out.some((c) => /\$\.list\[\d+\.\.\d+\]/.test(c.title))).toBe(true);
    for (const c of out) expect(c.body.length).toBeLessThanOrEqual(2000);
  });

  it("falls back to text for invalid JSON", () => {
    const out = chunkJson("{not json", "bad.json");
    expect(out).toHaveLength(1);
  });
});

describe("sniffKind / chunk", () => {
  it("uses extension first, then content", () => {
    expect(sniffKind("hello", "a/b.md")).toBe("markdown");
    expect(sniffKind("x", "a.ts")).toBe("code");
    expect(sniffKind('{"a":1}')).toBe("json");
    expect(sniffKind("# Heading\ntext")).toBe("markdown");
    expect(sniffKind("plain log line\nanother line")).toBe("prose");
  });

  it("produces hashed, ordered chunks", () => {
    const { chunks } = chunk("# A\none\n# B\ntwo", "t");
    expect(chunks.map((c) => c.ord)).toEqual([0, 1]);
    expect(chunks[0]!.hash).toHaveLength(40);
    expect(chunks[0]!.contentType).toBe("prose");
  });
});
