import type { ResolvedConfig } from "./config.js"
import type { PnpmListEntry } from "./workspace.js"

export const ROOT = "/repo"

export const CONFIG: ResolvedConfig = {
  groups: {
    core: {
      packages: ["packages/*", "packages/exchange/wire", "!packages/react"],
    },
    bindings: { packages: ["packages/react"] },
    experimental: { packages: ["experimental/*"] },
  },
  remotes: ["origin"],
  buildCommand: "pnpm build",
  testCommand: "pnpm test",
}

export const ENTRIES: PnpmListEntry[] = [
  { name: "root", path: ROOT, private: true },
  { name: "@scope/a", path: `${ROOT}/packages/a` },
  { name: "@scope/b", path: `${ROOT}/packages/b` },
  { name: "@scope/ind", path: `${ROOT}/packages/ind` },
  { name: "@scope/react", path: `${ROOT}/packages/react` },
  { name: "@scope/wire", path: `${ROOT}/packages/exchange/wire` },
  { name: "@scope/priv", path: `${ROOT}/experimental/priv`, private: true },
]

export const FIXTURE: Record<string, Record<string, unknown>> = {
  [`${ROOT}/package.json`]: { name: "root", private: true },
  [`${ROOT}/packages/a/package.json`]: {
    name: "@scope/a",
    version: "1.0.0",
    dependencies: { "@scope/b": "workspace:^" },
  },
  [`${ROOT}/packages/b/package.json`]: { name: "@scope/b", version: "1.0.0" },
  [`${ROOT}/packages/ind/package.json`]: {
    name: "@scope/ind",
    version: "0.1.0",
    versioning: "independent",
  },
  [`${ROOT}/packages/react/package.json`]: {
    name: "@scope/react",
    version: "1.0.0",
  },
  [`${ROOT}/packages/exchange/wire/package.json`]: {
    name: "@scope/wire",
    version: "1.0.0",
  },
  [`${ROOT}/experimental/priv/package.json`]: {
    name: "@scope/priv",
    version: "9.9.9",
  },
}

export function readFixture(): (path: string) => Record<string, unknown> {
  return (path: string): Record<string, unknown> => {
    const pkg = FIXTURE[path]
    if (!pkg) throw new Error(`no fixture for ${path}`)
    return pkg
  }
}
