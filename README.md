# @halecraft/release

A zero-config release script for monorepos.

## Features

- **Zero configuration by default:** Works out of the box for simple monorepos.
- **Topological publishing:** Discovers workspace packages and publishes them in dependency order.
- **Selective bumping:** Group packages together to version them independently.
- **Independent versioning:** A package can opt out of its group's version train and publish on its own cadence.
- **Idempotent publishing:** Versions already on the registry are skipped, so re-running a release is safe.
- **Configurable:** Override defaults via CLI flags or a `release.config.ts` file.

## Usage

```sh
# Bump all packages to 0.1.0
pnpm exec release bump 0.1.0

# Bump specific packages or groups
pnpm exec release bump 0.1.0 --packages core @halecraft/utils

# Publish all packages
pnpm exec release publish

# Dry run publish
pnpm exec release publish --dry-run

# Check status of local vs npm registry versions
pnpm exec release status
```

## Versioning policies

Every package rides the "uniform" train by default: group and default bumps
write one version to it, and a release that ships the train tags it once as
`v<version>`.

A package that wants its own cadence declares independence in its own
`package.json`:

```jsonc
{
  "name": "@scope/standalone",
  "versioning": "independent"
}
```

Independent packages are skipped by default and group bumps, so a normal
release never touches their version. Bump one explicitly by name:

```sh
pnpm exec release bump 0.2.0 --packages @scope/standalone
```

`--packages` resolves group names before package names, so a package whose
name collides with a group must be named in full (e.g. `@kyneta/transport`
rather than `transport`).

## Publishing

`release publish` builds and tests the workspace, then publishes each
publishable package in dependency order. A package whose local version is
already on the npm registry is skipped rather than re-published, so re-running
a completed release publishes nothing and exits 0.

Tags follow the versioning model:

- Nothing published → no tag.
- The uniform train published at one version → `v<version>`.
- Each published independent package → `@scope/name@version`.

`--dry-run` runs the whole flow without publishing or pushing tags, and works
offline (an unreachable registry is treated as "would publish").

## Configuration

For advanced use cases, create a `release.config.ts` in the root of your workspace:

```ts
import { defineConfig } from "@halecraft/release"

export default defineConfig({
  // Named groups of packages for selective bumping
  groups: {
    core: { packages: ["packages/*"] },
    experimental: { packages: ["experimental/*"] },
  },

  // Git remotes to push tags to
  remotes: ["origin", "github"],

  // Commands to run before publishing
  buildCommand: "pnpm build",
  testCommand: "pnpm test",

  // npm access level
  access: "public",
})
```

A package belongs to every group whose glob matches its path; use a `!`
negation to exclude one (e.g. `["packages/*", "!packages/react"]`). Note that
`packages/*` does not match two-level paths like `packages/exchange/wire` —
list such paths explicitly.

All configuration options can also be overridden via CLI flags.
