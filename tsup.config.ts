import { defineConfig } from "tsup";

// Three entry points, one bundle each. Native and heavy deps stay external so
// they resolve from node_modules at runtime (better-sqlite3 has a .node binary;
// transformers/tree-sitter are large and optional).
export default defineConfig({
  entry: {
    server: "src/server.ts",
    hook: "src/hook.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  // One self-contained file per entry: the server, hook and CLI each read and compile a
  // single module at start-up instead of a dozen shared chunks (~5 ms less cold start
  // with the compile cache warm). Costs some duplicated code on disk, never in memory.
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  // Bundled CommonJS packages (fast-glob) call require() for Node builtins; give the
  // ESM output a real `require` so esbuild's shim does not throw at load time.
  banner: {
    js: 'import { createRequire as __emCreateRequire } from "node:module"; const require = __emCreateRequire(import.meta.url);',
  },
  // tsup externalises every package.json dependency by default, so zod, the MCP SDK
  // and fast-glob were resolved file by file from node_modules at start-up (~500
  // module loads, two thirds of the server's boot time). Bundling the pure-JS ones
  // leaves a handful of files to read; turndown stays external and is required lazily.
  noExternal: ["zod", "@modelcontextprotocol/sdk", "fast-glob", "ignore"],
  external: [
    "better-sqlite3",
    "sqlite-vec",
    "@huggingface/transformers",
    "onnxruntime-node",
    "web-tree-sitter",
    "tsx",
  ],
});
