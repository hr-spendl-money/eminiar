---
name: release/pr-version-bump
kind: constraint
tags: [release, workflow, pr, versioning]
related: [file:.github/workflows/publish.yml, file:scripts/sync-plugin-version.mjs, file:package.json, file:.claude-plugin/plugin.json]
created: 2026-10-15T18:44:30.308Z
updated: 2026-10-15T18:44:30.308Z
---

Workflow rule (2026-10-15): work on a new branch per feature, open a PR for review when the feature is complete, and every PR must bump the package version so merging it releases. .github/workflows/publish.yml runs on every push to main and publishes to npm only when package.json's version is not already on the registry, so a merge without a bump releases nothing. It also runs scripts/sync-plugin-version.mjs --check, so .claude-plugin/plugin.json must carry the same version. Bump with `npm version patch|minor|major --no-git-tag-version`: the `version` npm script syncs and stages plugin.json, and the workflow creates the v<version> tag and GitHub release itself, so don't tag locally. Use patch for fixes/polish and minor for features.
