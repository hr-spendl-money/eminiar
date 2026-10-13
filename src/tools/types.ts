import type { z } from "zod";
import type { ProjectContext } from "../context.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ProjectContext) => Promise<ToolResult>;
}

/** Identity helper that pins the generic so handlers get typed args. */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

export function errorResult(s: string): ToolResult {
  return { content: [{ type: "text", text: s }], isError: true };
}
