import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearNeedsAuthEntry,
  needsAuthEntry,
  PLUGIN_SERVER_ID,
  pluginCacheDirs,
} from "../../src/install/claude-config.js";
import { pinnedRoot, pinRoot } from "../../src/install/node-resolve.js";

let claudeDir: string;

beforeAll(() => {
  claudeDir = mkdtempSync(join(tmpdir(), "em-claude-"));
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.EMINIAR_HOME = mkdtempSync(join(tmpdir(), "em-home-"));
});
afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.EMINIAR_HOME;
});

describe("Claude Code's cached launch failure", () => {
  const file = () => join(claudeDir, "mcp-needs-auth-cache.json");

  it("is absent when the file is missing or malformed", () => {
    expect(needsAuthEntry()).toBeUndefined();
    writeFileSync(file(), "{not json");
    expect(needsAuthEntry()).toBeUndefined();
  });

  it("is detected and cleared without touching other servers", () => {
    writeFileSync(
      file(),
      JSON.stringify({
        "plugin:engineering:notion": { timestamp: 1 },
        [PLUGIN_SERVER_ID]: { timestamp: 1791903789771, id: "e9907c944b7110a9" },
      }),
    );
    expect(needsAuthEntry()).toEqual({ timestamp: 1791903789771 });
    expect(clearNeedsAuthEntry()).toBe(true);
    expect(needsAuthEntry()).toBeUndefined();
    const left = JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;
    expect(Object.keys(left)).toEqual(["plugin:engineering:notion"]);
    expect(existsSync(`${file()}.eminiar.bak`)).toBe(true);
    expect(clearNeedsAuthEntry()).toBe(false);
  });
});

describe("plugin cache directories", () => {
  it("lists only version directories that carry the server shim, oldest first", () => {
    const base = join(claudeDir, "plugins", "cache", "eminiar", "eminiar");
    for (const v of ["0.1.1", "0.1.0"]) {
      mkdirSync(join(base, v, "bin"), { recursive: true });
      writeFileSync(join(base, v, "bin", "em-server"), "#!/bin/sh\n");
    }
    mkdirSync(join(base, "0.0.9"), { recursive: true });
    expect(pluginCacheDirs().map((d) => d.split("/").pop())).toEqual(["0.1.0", "0.1.1"]);
  });
});

describe("root-path pin", () => {
  it("only accepts a root with dist/server.js and forgets one that lost it", () => {
    const root = mkdtempSync(join(tmpdir(), "em-root-"));
    expect(() => pinRoot(root)).toThrow(/dist\/server\.js/);
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "server.js"), "");
    expect(pinRoot(root)).toBe(root);
    expect(pinnedRoot()).toBe(root);
    expect(readFileSync(join(process.env.EMINIAR_HOME!, "root-path"), "utf8")).toBe(root);
  });
});
