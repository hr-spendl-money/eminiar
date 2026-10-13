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
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  external: [
    "better-sqlite3",
    "sqlite-vec",
    "@huggingface/transformers",
    "onnxruntime-node",
    "web-tree-sitter",
    "tsx",
  ],
});
