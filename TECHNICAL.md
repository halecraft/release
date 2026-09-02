# @halecraft/release — Technical Reference

> **Package**: `@halecraft/release`
> **Role**: Zero-config release tool for monorepos — version bumping, idempotent publishing, and release tagging.
> **Depends on**: `jiti` (config loading), `picomatch` (group globs)
> **Commands**: `bump`, `publish`, `status`

## The versioning model

Two policies, declared per package in `package.json`:

- `"uniform"` (default) — the package rides its group's version train. Group
  and default bumps write one version to it, and a release that ships the
  train at one version tags it once as `v<version>`.
- `"independent"` — the package is skipped by default and group bumps. It is
  only bumped when named explicitly in `--packages`, and a release that ships
  it tags `@scope/name@version`.

The policy is data, not code: discovery reads `versioning` from each
`package.json`, and `bump`/`publish` are pure functions over that data.

## Structure

- `src/workspace.ts` — `discoverWorkspace` is the I/O shell (pnpm ls + fs);
  `buildWorkspace` is the pure core (entries + config + a package.json
  reader). A package belongs to every config group whose picomatch glob
  matches its path; `packages/*` does not match two-level paths, so those must
  be listed explicitly. `computePublishTiers` is Kahn's algorithm over
  internal dependencies.
- `src/registry.ts` — `fetchRegistryVersion` queries the npm registry.
- `src/commands/bump.ts` — `resolveBumpTargets` is a pure function returning
  `{ targets, skipped, emptyGroups }`. Group names resolve before package
  names, and an explicitly named package always wins over its policy.
- `src/commands/publish.ts` — `decidePublishAction` and `computeTagPlan` are
  pure; the loop gathers registry state, then executes. Publish aborts if the
  registry cannot be reached; `--dry-run` treats that as "would publish" so it
  works offline.
- `src/commands/status.ts` — registry comparison, with an `[independent]`
  marker.

## Gotchas

- The auth preflight runs `pnpm whoami`, matching the `pnpm publish` step.
  `pnpm login` stores its token in `~/.config/pnpm/auth.ini`, which `npm whoami`
  would never see — checking auth with npm would reject a perfectly valid pnpm
  login.
- A configured group with no publishable members (all private) is a no-op, not
  an error: `bump --packages experimental` prints a message and exits 0.
- A group name that collides with a package name shadows it in `--packages`;
  name the package in full.
- Tags are computed from the packages actually published in a run, so a
  release that publishes nothing creates no tag.
