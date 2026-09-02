import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ResolvedConfig } from "../config.js"
import {
  discoverWorkspace,
  type Workspace,
  type WorkspacePackage,
} from "../workspace.js"

function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

/** Which packages a bump run will touch, skip, and find empty. */
export type BumpPlan = {
  targets: WorkspacePackage[]
  skipped: WorkspacePackage[]
  /** Config groups that were named but hold no publishable packages. */
  emptyGroups: string[]
}

/**
 * Decide what a bump applies to. Independent packages ride their own version
 * train, so group and default bumps skip them; naming one explicitly in
 * --packages is the override that lets it be bumped alone.
 */
export function resolveBumpTargets(
  workspace: Workspace,
  config: ResolvedConfig,
  packagesFlag?: string[],
): BumpPlan {
  const targets: WorkspacePackage[] = []
  const skipped: WorkspacePackage[] = []
  const emptyGroups: string[] = []

  if (packagesFlag && packagesFlag.length > 0) {
    // Group names are resolved before package names, so a group that shares
    // a name with a package shadows it; name the package in full to reach it.
    for (const name of packagesFlag) {
      if (config.groups?.[name] !== undefined) {
        // A configured group may hold only private packages (none
        // publishable); that is a no-op rather than an error.
        const members = workspace.groups.get(name) ?? []
        if (members.length === 0) {
          emptyGroups.push(name)
          continue
        }
        for (const member of members) {
          if (member.versioning === "independent") {
            skipped.push(member)
          } else {
            targets.push(member)
          }
        }
      } else {
        const pkg = workspace.publishable.find(p => p.name === name)
        if (pkg) {
          targets.push(pkg)
        } else {
          throw new Error(`Unknown package or group "${name}"`)
        }
      }
    }
  } else {
    for (const pkg of workspace.publishable) {
      if (pkg.versioning === "independent") {
        skipped.push(pkg)
      } else {
        targets.push(pkg)
      }
    }
  }

  return {
    targets: dedupeByName(targets),
    skipped: dedupeByName(skipped),
    emptyGroups: [...new Set(emptyGroups)],
  }
}

function dedupeByName(pkgs: WorkspacePackage[]): WorkspacePackage[] {
  const seen = new Set<string>()
  const out: WorkspacePackage[] = []
  for (const pkg of pkgs) {
    if (!seen.has(pkg.name)) {
      seen.add(pkg.name)
      out.push(pkg)
    }
  }
  return out
}

export function bump(
  cwd: string,
  version: string,
  config: ResolvedConfig,
  packagesFlag?: string[],
): void {
  if (!isValidSemver(version)) {
    console.error(`Invalid semver: ${version}`)
    process.exit(1)
  }

  const workspace = discoverWorkspace(cwd, config)
  let plan: BumpPlan
  try {
    plan = resolveBumpTargets(workspace, config, packagesFlag)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exit(1)
  }

  for (const name of plan.emptyGroups) {
    console.log(`No publishable packages in group ${name}.`)
  }
  for (const pkg of plan.skipped) {
    console.log(`  Skipping ${pkg.name} (independent versioning)`)
  }

  if (plan.targets.length === 0) {
    console.log("No packages to bump.")
    return
  }

  console.log(`\nBumping to ${version}:\n`)
  for (const pkg of plan.targets) {
    const pkgPath = resolve(cwd, pkg.path, "package.json")
    const pkgJson = readJson(pkgPath)
    const oldVersion = pkgJson.version as string
    pkgJson.version = version
    writeJson(pkgPath, pkgJson)
    console.log(`  ${pkg.name}: ${oldVersion} → ${version}`)
  }

  console.log(`\nDone. Bumped ${plan.targets.length} package(s).\n`)
}
