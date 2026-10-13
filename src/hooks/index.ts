import {
  postToolUse,
  postToolUseFailure,
  sessionEnd,
  stop,
  subagentStop,
  userPromptSubmit,
} from "./capture.js";
import { preCompact } from "./pre-compact.js";
import { preToolUse } from "./routing.js";
import { sessionStart } from "./session-start.js";
import type { HookHandler } from "./types.js";

/** Event → handler. Unknown events are a no-op so hooks.json may list more than we handle. */
export const handlers: Record<string, HookHandler> = {
  SessionStart: sessionStart,
  UserPromptSubmit: userPromptSubmit,
  PreToolUse: preToolUse,
  PostToolUse: postToolUse,
  PostToolUseFailure: postToolUseFailure,
  SubagentStop: subagentStop,
  PreCompact: preCompact,
  Stop: stop,
  SessionEnd: sessionEnd,
};
