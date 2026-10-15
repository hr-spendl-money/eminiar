// Copies prebuilt tree-sitter grammar wasm files from devDependencies into
// vendor/grammars so the published package (and plugin dir) is self-contained.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "vendor", "grammars");
mkdirSync(out, { recursive: true });
const files = [
  ["tree-sitter-typescript/tree-sitter-typescript.wasm", "typescript.wasm"],
  ["tree-sitter-typescript/tree-sitter-tsx.wasm", "tsx.wasm"],
  ["tree-sitter-javascript/tree-sitter-javascript.wasm", "javascript.wasm"],
  ["tree-sitter-python/tree-sitter-python.wasm", "python.wasm"],
  ["tree-sitter-go/tree-sitter-go.wasm", "go.wasm"],
  ["tree-sitter-php/tree-sitter-php.wasm", "php.wasm"],
];
for (const [src, dst] of files) {
  copyFileSync(join(root, "node_modules", src), join(out, dst));
  console.log(`vendor/grammars/${dst}`);
}
