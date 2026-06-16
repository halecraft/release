import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ResolvedConfig } from "../config.js"
import { discoverWorkspace, type WorkspacePackage } from "../workspace.js"

function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
}

export function bump(
  cwd: string,
  version: string,
  config: ResolvedConfig,
  packagesFlag?: string[]
): void {
  if (!isValidSemver(version)) {
    console.error(`Invalid semver: ${version}`)
    process.exit(1)
  }

  const workspace = discoverWorkspace(cwd, config)

  let targets: WorkspacePackage[] = []

  if (packagesFlag && packagesFlag.length > 0) {
    // If explicit packages or groups are provided via CLI
    for (const name of packagesFlag) {
      if (workspace.groups.has(name)) {
        targets.push(...workspace.groups.get(name)!)
      } else {
        const pkg = workspace.publishable.find((p) => p.name === name)
        if (pkg) {
          targets.push(pkg)
        } else {
          console.error(`Error: Unknown package or group "${name}"`)
          process.exit(1)
        }
      }
    }
    // Deduplicate
    targets = [...new Set(targets)]
  } else {
    // Default: bump all publishable packages
    targets = workspace.publishable
  }

  if (targets.length === 0) {
    console.log("No packages to bump.")
    return
  }

  console.log(`\nBumping to ${version}:\n`)
  for (const pkg of targets) {
    const pkgPath = resolve(cwd, pkg.path, "package.json")
    const pkgJson = readJson(pkgPath)
    const oldVersion = pkgJson.version as string
    pkgJson.version = version
    writeJson(pkgPath, pkgJson)
    console.log(`  ${pkg.name}: ${oldVersion} → ${version}`)
  }

  console.log(`\nDone. Bumped ${targets.length} package(s).\n`)
}
