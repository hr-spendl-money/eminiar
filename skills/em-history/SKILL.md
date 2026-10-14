---
name: em-history
description: Understand the project's git history — what changed, why, by whom, which changes later needed fixing, how branches relate — and use it to inform the change at hand. Overview, a file's story before editing it, the risk of the working tree, one commit, a branch vs the base, a symbol's line history, search by message.
user-invocable: true
argument-hint: <overview|file|risk|commit|branch|symbol|search|timeline> [path, sha, branch, name path or query]
allowed-tools: mcp__plugin_eminiar_eminiar__em_history, mcp__plugin_eminiar_eminiar__em_search, mcp__plugin_eminiar_eminiar__em_graph_impact, mcp__plugin_eminiar_eminiar__em_symbols
---

Arguments: $ARGUMENTS

`em_history` reads git for you (log across all branches, refs, diffs, blame) and returns a
compact, classified picture instead of raw output. Every commit is classified
(feat/fix/refactor/perf/test/docs/chore/…); every fix is traced back, by blaming the lines it
removed, to the commit that wrote them (the likely cause of the bug). Commit messages are also
indexed, so `em_search` finds them under source `git`.

- `overview` (or no argument) → `em_history {action:"overview"}`: activity, kind mix, lessons,
  bug-prone files, unmerged branches, releases, commits worth knowing about.
- `file <path>` → `{action:"file", path}`: the file's commits, its fixes, changes to it that later
  needed fixing (and how many days later), co-changing files, memories that mention it. **Call this
  before editing a file with a fix-heavy history.**
- `risk` → `{action:"risk"}`: the history risk of every file changed in the working tree (or
  `paths`), with the last fix to re-read. Run it before committing, next to `em_graph_changes`.
- `commit <sha|tag|branch>` → `{action:"commit", sha}`: message, files with the symbols touched,
  what it later needed (fixes that removed its lines, reverts) or what it fixed, branches containing it.
- `branch [name]` → `{action:"branch", name}`: commits unique to the branch vs the base, files
  touched and which of them are bug-prone, ahead/behind, merged or not.
- `symbol <Class/method | src/x.ts#fn>` → `{action:"symbol", name_path}`: commits that touched the
  symbol's lines (`git log -L`), with the fixes among them.
- `search <text>` / `timeline` → `{action:"search", query}` / `{action:"timeline", kinds, author,
  path, since:"30d", risky}`: find when and why something happened.

How to use what comes back:

- A commit flagged `⚠ n later fixes` or a file with `risk ≥ 0.3` is a signal, not a verdict: read
  the fixes it points at (`commit <sha>`) and protect the behaviour they restored with a test before
  changing that code again.
- "Bugs typically surfaced N days after the change" and "fixes traced back to: k refactor" are the
  project's own pattern; mention them when proposing a similar kind of change.
- Prefer the tool's reasons over re-deriving from `git log`; cite shas so the user can open them in
  the dashboard (`eminiar ui` → History).
- `tracePending > 0` means some fixes are not blamed yet (the trace is budgeted per call); call
  again when the answer matters.
