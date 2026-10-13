import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { findProjectRoot, projectId } from "../../src/project.js";

describe("config", () => {
  let home: string;
  let root: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "em-home-"));
    root = mkdtempSync(join(tmpdir(), "em-root-"));
    process.env.EMINIAR_HOME = home;
  });
  afterEach(() => {
    delete process.env.EMINIAR_HOME;
    delete process.env.EMINIAR_ROUTING_MODE;
  });

  it("uses defaults with no files", () => {
    const c = loadConfig(root);
    expect(c.routing.mode).toBe("auto");
    expect(c.sandbox.indexThreshold).toBe(5120);
  });

  it("project file overrides home file, env overrides both", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ routing: { mode: "off" } }));
    expect(loadConfig(root).routing.mode).toBe("off");
    writeFileSync(
      join(root, "eminiar.config.json"),
      JSON.stringify({ routing: { mode: "annotate" } }),
    );
    expect(loadConfig(root).routing.mode).toBe("annotate");
    process.env.EMINIAR_ROUTING_MODE = "enforce";
    expect(loadConfig(root).routing.mode).toBe("enforce");
  });

  it("falls back to defaults on invalid config", () => {
    writeFileSync(
      join(root, "eminiar.config.json"),
      JSON.stringify({ routing: { mode: "bogus" } }),
    );
    expect(loadConfig(root).routing.mode).toBe("auto");
  });
});

describe("project", () => {
  it("finds the root by marker and hashes it stably", () => {
    const root = mkdtempSync(join(tmpdir(), "em-proj-"));
    writeFileSync(join(root, "package.json"), "{}");
    const nested = join(root, "src", "deep");
    expect(findProjectRoot(nested)).toBe(root);
    expect(projectId(root)).toHaveLength(16);
    expect(projectId(root)).toBe(projectId(root));
  });
});
