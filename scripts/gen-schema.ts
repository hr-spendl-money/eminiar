// Emits eminiar.config.schema.json from the zod config schema so editors can
// validate the committed team config. Run via `npm run build`.
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { ConfigSchema } from "../src/config.js";

const schema = z.toJSONSchema(ConfigSchema, { io: "input" }) as Record<string, unknown>;
schema.$schema = "https://json-schema.org/draft/2020-12/schema";
schema.title = "eminiar.config.json";
schema.description = "Per-project eminiar settings. Commit this file so teammates share the same behaviour.";
writeFileSync("eminiar.config.schema.json", `${JSON.stringify(schema, null, 2)}\n`);
console.log("eminiar.config.schema.json");
