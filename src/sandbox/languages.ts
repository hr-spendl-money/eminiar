import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { paths } from "../paths.js";

const require = createRequire(import.meta.url);

/** Find an executable on PATH (no shell). */
export function findOnPath(bin: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, bin);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export interface Language {
  id: string;
  aliases: string[];
  ext: string;
  /** Resolves the interpreter; undefined when not installed. */
  detect: () => string | undefined;
  /** argv to run `file` (code already written to it). `bin` is the detect() result. */
  argv: (bin: string, file: string) => string[];
}

function preferredShell(): string {
  const sh = process.env.SHELL ?? "";
  if (/\/(zsh|bash)$/.test(sh) && existsSync(sh)) return sh;
  return findOnPath("bash") ?? findOnPath("zsh") ?? "/bin/sh";
}

function tsxCli(): string {
  return require.resolve("tsx/cli");
}

export const LANGUAGES: Language[] = [
  {
    id: "shell",
    aliases: ["sh", "bash", "zsh"],
    ext: ".sh",
    detect: preferredShell,
    argv: (bin, file) => [bin, file],
  },
  {
    id: "javascript",
    aliases: ["js", "node", "mjs"],
    ext: ".mjs",
    detect: () => process.execPath,
    argv: (bin, file) => [bin, "--no-warnings", file],
  },
  {
    id: "typescript",
    aliases: ["ts"],
    ext: ".ts",
    detect: () => process.execPath,
    argv: (bin, file) => [bin, "--no-warnings", tsxCli(), file],
  },
  {
    id: "python",
    aliases: ["py", "python3"],
    ext: ".py",
    detect: () => findOnPath("python3") ?? findOnPath("python"),
    argv: (bin, file) => [bin, file],
  },
  {
    id: "ruby",
    aliases: ["rb"],
    ext: ".rb",
    detect: () => findOnPath("ruby"),
    argv: (b, f) => [b, f],
  },
  {
    id: "go",
    aliases: ["golang"],
    ext: ".go",
    detect: () => findOnPath("go"),
    argv: (b, f) => [b, "run", f],
  },
  { id: "php", aliases: [], ext: ".php", detect: () => findOnPath("php"), argv: (b, f) => [b, f] },
  {
    id: "perl",
    aliases: ["pl"],
    ext: ".pl",
    detect: () => findOnPath("perl"),
    argv: (b, f) => [b, f],
  },
  {
    id: "r",
    aliases: ["rscript"],
    ext: ".R",
    detect: () => findOnPath("Rscript"),
    argv: (b, f) => [b, f],
  },
  {
    id: "elixir",
    aliases: ["exs"],
    ext: ".exs",
    detect: () => findOnPath("elixir"),
    argv: (b, f) => [b, f],
  },
  {
    id: "rust",
    aliases: ["rs"],
    ext: ".rs",
    detect: () => (findOnPath("cargo") && findOnPath("rustc") ? findOnPath("rustc") : undefined),
    // compile-and-run via a tiny shell wrapper; the binary lands next to the source
    argv: (bin, file) => [
      preferredShell(),
      "-c",
      `"${bin}" -o "${file}.bin" "${file}" && "${file}.bin"`,
    ],
  },
  {
    id: "csharp",
    aliases: ["cs", "dotnet-script"],
    ext: ".csx",
    detect: () => findOnPath("dotnet-script"),
    argv: (b, f) => [b, f],
  },
];

export function resolveLanguage(name: string): Language | undefined {
  const n = name.toLowerCase();
  return LANGUAGES.find((l) => l.id === n || l.aliases.includes(n));
}

export function availableLanguages(): Array<{ id: string; bin: string | undefined }> {
  return LANGUAGES.map((l) => {
    let bin: string | undefined;
    try {
      bin = l.detect();
    } catch {
      bin = undefined;
    }
    return { id: l.id, bin };
  });
}

/** Write code to a scratch file under ~/.eminiar/tmp and return its path. */
export function writeScratch(code: string, ext: string): string {
  const dir = paths().tmp;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `em-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  writeFileSync(file, code, { mode: 0o600 });
  return file;
}
