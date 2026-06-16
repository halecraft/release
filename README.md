# @halecraft/release

A zero-config release script for monorepos.

## Features

- **Zero configuration by default:** Works out of the box for simple monorepos.
- **Topological publishing:** Discovers workspace packages and publishes them in dependency order.
- **Selective bumping:** Group packages together to version them independently.
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

All configuration options can also be overridden via CLI flags.
