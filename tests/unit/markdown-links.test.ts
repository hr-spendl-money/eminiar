import { describe, expect, it } from "vitest";
import { classifyHref, dashboardHref } from "../../src/ui/web/markdown/links.js";

describe("memory markdown links", () => {
  it("routes memory and file references to dashboard views", () => {
    expect(classifyHref("mem:auth/session-tokens")).toEqual({
      kind: "memory",
      name: "auth/session-tokens",
    });
    expect(classifyHref("file:src/auth.ts")).toEqual({ kind: "file", file: "src/auth.ts" });
    expect(classifyHref("sym:src/auth.ts#issueToken")).toEqual({
      kind: "file",
      file: "src/auth.ts",
    });
    expect(classifyHref("./docs/plan.md#L10")).toEqual({ kind: "file", file: "docs/plan.md" });
    expect(dashboardHref({ kind: "memory", name: "auth/x" })).toBe("#/memory?name=auth%2Fx");
    expect(dashboardHref({ kind: "file", file: "src/a b.ts" })).toBe(
      "#/explore?file=src%2Fa%20b.ts",
    );
  });

  it("keeps web links external and refuses other schemes", () => {
    expect(classifyHref("https://example.com/x?y=1")).toEqual({
      kind: "external",
      href: "https://example.com/x?y=1",
    });
    expect(classifyHref("mailto:someone@example.com").kind).toBe("external");
    expect(classifyHref("#section")).toEqual({ kind: "anchor", href: "#section" });
    expect(classifyHref("javascript:alert(1)")).toEqual({ kind: "text" });
    expect(classifyHref("data:text/html,<b>x</b>")).toEqual({ kind: "text" });
    expect(classifyHref("vbscript:msgbox")).toEqual({ kind: "text" });
    expect(classifyHref("mem:")).toEqual({ kind: "text" });
    expect(classifyHref("   ")).toEqual({ kind: "text" });
    expect(dashboardHref({ kind: "external", href: "https://e" })).toBeUndefined();
  });
});
