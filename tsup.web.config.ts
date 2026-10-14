import { defineConfig } from "tsup";

// The dashboard frontend: one browser bundle (Preact + d3-force + Prism, all inlined)
// plus the static files from src/ui/web/public, written to dist/ui after the node
// build (which cleans dist). Served by src/ui/server.ts; nothing is loaded from a CDN.
export default defineConfig({
  entry: { app: "src/ui/web/main.tsx" },
  format: ["iife"],
  platform: "browser",
  target: "es2020",
  outDir: "dist/ui",
  clean: false,
  splitting: false,
  sourcemap: false,
  minify: true,
  dts: false,
  shims: false,
  noExternal: [/.*/],
  publicDir: "src/ui/web/public",
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "preact";
    options.define = { ...options.define, "process.env.NODE_ENV": '"production"' };
  },
});
