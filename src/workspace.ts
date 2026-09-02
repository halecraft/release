import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import picomatch from "picomatch"
import type { ResolvedConfig } from "./config.js"

export type VersioningPolicy = "uniform" | "independent"

export type WorkspacePackage = {
  name: string
  version: string
  path: string // relative to repo root
  private: boolean
  internalDeps: string[] // names of other workspace packages it depends on
  groups: string[] // computed from config
  versioning: VersioningPolicy // a package's opt-out of its group's version train
}

export type Workspace = {
  all: WorkspacePackage[]
  publishable: WorkspacePackage[]
  groups: Map<string, WorkspacePackage[]>
}

export type PnpmListEntry = {
  name: string
  version?: string
  path: string
  private?: boolean
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

/** The versioning policy a package declares for itself; anything else is uniform. */
function versioningOf(pkgJson: Record<string, unknown>): VersioningPolicy {
  return pkgJson.versioning === "independent" ? "independent" : "uniform"
}

function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some(pattern => picomatch.isMatch(relPath, pattern))
}

/**
 * A group's pattern list may mix positives with `!` negations. picomatch
 * ignores negations inside an array, so evaluate them explicitly: a package
 * belongs when it matches a positive pattern and no negation.
 */
function matchesGroup(relPath: string, patterns: string[]): boolean {
  const positives = patterns.filter(p => !p.startsWith("!"))
  const negations = patterns.filter(p => p.startsWith("!"))
  if (!matchesAny(relPath, positives)) return false
  return !matchesAny(
    relPath,
    negations.map(p => p.slice(1)),
  )
}

/**
 * I/O shell: ask pnpm what the workspace looks like, then hand the raw
 * listing to the pure core so the logic is testable without a filesystem.
 */
export function discoverWorkspace(
  cwd: string,
  config: ResolvedConfig,
): Workspace {
  const raw = execSync("pnpm ls -r --depth -1 --json", {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
  const entries = JSON.parse(raw) as PnpmListEntry[]
  return buildWorkspace(entries, config, cwd)
}

/** Pure core: turn a pnpm listing into a Workspace. */
export function buildWorkspace(
  entries: PnpmListEntry[],
  config: ResolvedConfig,
  root: string,
  readPkgJson: (path: string) => Record<string, unknown> = readJson,
): Workspace {
  const workspaceNames = new Set(entries.map(e => e.name))
  const all: WorkspacePackage[] = []

  for (const entry of entries) {
    // The monorepo root is usually a private package that only holds scripts.
    if (resolve(entry.path) === resolve(root) && (entry.private ?? false)) {
      continue
    }

    const relPath = relative(root, resolve(entry.path))
    const pkgJson = readPkgJson(resolve(entry.path, "package.json"))

    const deps = pkgJson.dependencies as Record<string, string> | undefined
    const peerDeps = pkgJson.peerDependencies as
      | Record<string, string>
      | undefined
    const internalDeps = [
      ...new Set([
        ...Object.keys(deps ?? {}).filter(k => workspaceNames.has(k)),
        ...Object.keys(peerDeps ?? {}).filter(k => workspaceNames.has(k)),
      ]),
    ].sort()

    // A package can belong to every group whose globs match its path.
    const matchedGroups: string[] = []
    if (config.groups) {
      for (const [groupName, groupDef] of Object.entries(config.groups)) {
        if (matchesGroup(relPath, groupDef.packages)) {
          matchedGroups.push(groupName)
        }
      }
    }

    all.push({
      name: entry.name,
      version: (pkgJson.version as string) ?? "0.0.0",
      path: relPath,
      private: entry.private ?? false,
      internalDeps,
      groups: matchedGroups,
      versioning: versioningOf(pkgJson),
    })
  }

  const publishable = all.filter(p => !p.private)

  const groups = new Map<string, WorkspacePackage[]>()
  for (const pkg of publishable) {
    for (const g of pkg.groups) {
      const existing = groups.get(g)
      if (existing) {
        existing.push(pkg)
      } else {
        groups.set(g, [pkg])
      }
    }
  }
  // Sort each group's packages by name for stable output
  for (const pkgs of groups.values()) {
    pkgs.sort((a, b) => a.name.localeCompare(b.name))
  }

  return { all, publishable, groups }
}

/**
 * Compute publish tiers via Kahn's algorithm.
 * Each tier contains packages whose dependencies are all in earlier tiers.
 */
export function computePublishTiers(
  packages: WorkspacePackage[],
): WorkspacePackage[][] {
  const nameToPackage = new Map(packages.map(p => [p.name, p]))
  const inDegree = new Map(packages.map(p => [p.name, 0]))
  const dependents = new Map(packages.map(p => [p.name, [] as string[]]))

  for (const pkg of packages) {
    for (const dep of pkg.internalDeps) {
      // dependents only knows packages in the set; anything else is external
      const children = dependents.get(dep)
      if (children) {
        children.push(pkg.name)
        inDegree.set(pkg.name, (inDegree.get(pkg.name) ?? 0) + 1)
      }
    }
  }

  const tiers: WorkspacePackage[][] = []
  let queue = packages
    .filter(p => (inDegree.get(p.name) ?? 0) === 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  while (queue.length > 0) {
    tiers.push(queue)
    const next: WorkspacePackage[] = []
    for (const pkg of queue) {
      for (const child of dependents.get(pkg.name) ?? []) {
        const newDegree = (inDegree.get(child) ?? 0) - 1
        inDegree.set(child, newDegree)
        if (newDegree === 0) {
          const ready = nameToPackage.get(child)
          if (ready) next.push(ready)
        }
      }
    }
    queue = next.sort((a, b) => a.name.localeCompare(b.name))
  }

  // Cycle detection: if any package still has in-degree > 0, there's a cycle
  const stuck = packages.filter(p => (inDegree.get(p.name) ?? 0) > 0)
  if (stuck.length > 0) {
    const names = stuck.map(p => p.name).join(", ")
    throw new Error(`Dependency cycle detected among: ${names}`)
  }

  return tiers
}
