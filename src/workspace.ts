import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve, relative } from "node:path"
import picomatch from "picomatch"
import type { ResolvedConfig } from "./config.js"

export type WorkspacePackage = {
  name: string
  version: string
  path: string // relative to repo root
  private: boolean
  internalDeps: string[] // names of other workspace packages it depends on
  groups: string[] // computed from config
}

export type Workspace = {
  all: WorkspacePackage[]
  publishable: WorkspacePackage[]
  groups: Map<string, WorkspacePackage[]>
}

type PnpmListEntry = {
  name: string
  version?: string
  path: string
  private?: boolean
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function discoverWorkspace(cwd: string, config: ResolvedConfig): Workspace {
  const raw = execSync("pnpm ls -r --depth -1 --json", {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
  const entries = JSON.parse(raw) as PnpmListEntry[]

  const workspaceNames = new Set(entries.map(e => e.name))
  const all: WorkspacePackage[] = []

  for (const entry of entries) {
    // Skip the root only if it's explicitly private (typical monorepo root)
    if (resolve(entry.path) === resolve(cwd) && (entry.private ?? false)) continue

    const relPath = relative(cwd, resolve(entry.path))
    const pkgJson = readJson(resolve(entry.path, "package.json"))

    const deps = pkgJson.dependencies as Record<string, string> | undefined
    const peerDeps = pkgJson.peerDependencies as Record<string, string> | undefined
    
    const internalDeps = [
      ...new Set([
        ...Object.keys(deps ?? {}).filter((k) => workspaceNames.has(k)),
        ...Object.keys(peerDeps ?? {}).filter((k) => workspaceNames.has(k)),
      ]),
    ].sort()

    // Determine groups based on config
    const matchedGroups: string[] = []
    if (config.groups) {
      for (const [groupName, groupDef] of Object.entries(config.groups)) {
        const isMatch = picomatch.isMatch(relPath, groupDef.packages)
        if (isMatch) {
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
    })
  }

  const publishable = all.filter((p) => !p.private)

  const groups = new Map<string, WorkspacePackage[]>()
  for (const pkg of publishable) {
    if (pkg.groups.length === 0) {
      // If no groups matched (or no config), it belongs to an implicit "all" group?
      // Actually, if no groups are defined, we don't need to populate the map,
      // but let's put everything in an implicit "all" group if no config.groups is provided.
    }
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

export function computePublishTiers(packages: WorkspacePackage[]): WorkspacePackage[][] {
  const nameToPackage = new Map(packages.map((p) => [p.name, p]))
  const inDegree = new Map(packages.map((p) => [p.name, 0]))
  const dependents = new Map(packages.map((p) => [p.name, [] as string[]]))

  for (const pkg of packages) {
    for (const dep of pkg.internalDeps) {
      if (nameToPackage.has(dep)) {
        dependents.get(dep)!.push(pkg.name)
        inDegree.set(pkg.name, inDegree.get(pkg.name)! + 1)
      }
    }
  }

  const tiers: WorkspacePackage[][] = []
  let queue = packages
    .filter((p) => inDegree.get(p.name) === 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  while (queue.length > 0) {
    tiers.push(queue)
    const next: WorkspacePackage[] = []
    for (const pkg of queue) {
      for (const child of dependents.get(pkg.name)!) {
        const newDegree = inDegree.get(child)! - 1
        inDegree.set(child, newDegree)
        if (newDegree === 0) {
          next.push(nameToPackage.get(child)!)
        }
      }
    }
    queue = next.sort((a, b) => a.name.localeCompare(b.name))
  }

  const stuck = packages.filter((p) => inDegree.get(p.name)! > 0)
  if (stuck.length > 0) {
    const names = stuck.map((p) => p.name).join(", ")
    throw new Error(`Dependency cycle detected among: ${names}`)
  }

  return tiers
}
