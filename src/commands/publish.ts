import { execSync } from "node:child_process"
import { resolve } from "node:path"
import type { ResolvedConfig } from "../config.js"
import { fetchRegistryVersion } from "../registry.js"
import {
  computePublishTiers,
  discoverWorkspace,
  type WorkspacePackage,
} from "../workspace.js"

function run(cmd: string, opts?: { dryRun?: boolean; cwd?: string }): void {
  if (opts?.dryRun) {
    console.log(`  [dry-run] ${cmd}`)
    return
  }
  console.log(`  $ ${cmd}`)
  execSync(cmd, { cwd: opts?.cwd, stdio: "inherit" })
}

function checkNpmAuth(cwd: string): void {
  console.log("Checking npm authentication...\n")
  try {
    // pnpm owns auth for this tool (pnpm login → ~/.config/pnpm/auth.ini);
    // npm whoami would read ~/.npmrc instead and miss that token.
    const user = execSync("pnpm whoami", {
      cwd,
      encoding: "utf8",
    }).trim()
    console.log(`  Logged in as: ${user}\n`)
  } catch {
    console.error("Error: Not logged in. Run `pnpm login` first.\n")
    process.exit(1)
  }
}

/** Whether a package needs publishing, given what the registry already has. */
export function decidePublishAction(
  local: string,
  registry: string | "not published",
): "publish" | "skip" {
  return registry === local ? "skip" : "publish"
}

/**
 * Which git tags a release run creates. `v<version>` belongs to the lock-step
 * train; independent packages are tagged per-package, exactly when they ship.
 */
export function computeTagPlan(released: WorkspacePackage[]): string[] {
  if (released.length === 0) return []

  const train = released.filter(p => p.versioning === "uniform")
  const trainVersions = new Set(train.map(p => p.version))

  if (train.length > 0 && trainVersions.size === 1) {
    return [
      `v${train[0].version}`,
      ...released
        .filter(p => p.versioning === "independent")
        .map(p => `${p.name}@${p.version}`),
    ]
  }

  // A train released at mixed versions is an inconsistent release: tag every
  // package explicitly rather than guessing at a single release version.
  return released.map(p => `${p.name}@${p.version}`)
}

function createTag(
  cwd: string,
  config: ResolvedConfig,
  tagName: string,
  dryRun: boolean,
): void {
  if (dryRun) {
    run(`git tag ${tagName}`, { dryRun })
    for (const remote of config.remotes) {
      run(`git push ${remote} ${tagName}`, { dryRun })
    }
    return
  }

  const existingTag = execSync(`git tag -l "${tagName}"`, {
    cwd,
    encoding: "utf8",
  }).trim()

  if (existingTag) {
    const tagCommit = execSync(`git rev-list -n 1 "${tagName}"`, {
      cwd,
      encoding: "utf8",
    }).trim()
    const headCommit = execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
    }).trim()

    if (tagCommit === headCommit) {
      console.log(`  Tag ${tagName} already exists on HEAD, skipping.`)
    } else {
      console.error(
        `Error: tag ${tagName} already exists on commit ${tagCommit.slice(0, 8)}, but HEAD is ${headCommit.slice(0, 8)}.`,
      )
      console.error("Delete the existing tag or use a different version.")
      process.exit(1)
    }
  } else {
    run(`git tag ${tagName}`, { cwd })
    for (const remote of config.remotes) {
      run(`git push ${remote} ${tagName}`, { cwd })
    }
  }
}

export async function publish(
  cwd: string,
  config: ResolvedConfig,
  dryRun: boolean,
): Promise<void> {
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Publishing packages\n`)

  const workspace = discoverWorkspace(cwd, config)
  const tiers = computePublishTiers(workspace.publishable)

  // 0. Preflight — verify npm auth (skip for dry-runs)
  if (!dryRun) {
    checkNpmAuth(cwd)
  }

  // 1. Build
  console.log("Step 1/4: Building all packages...\n")
  run(config.buildCommand, { cwd })

  // 2. Test
  console.log("\nStep 2/4: Running tests...\n")
  run(config.testCommand, { cwd })

  if (workspace.publishable.length === 0) {
    console.log("No publishable packages found. Nothing to publish.\n")
    return
  }

  // 3. Publish in tier order, skipping versions the registry already has
  console.log("\nStep 3/4: Publishing in dependency order...\n")
  const published: WorkspacePackage[] = []
  const skipped: string[] = []
  const failed: string[] = []

  for (let tier = 0; tier < tiers.length; tier++) {
    const pkgs = tiers[tier]
    console.log(`\n── Tier ${tier} (${pkgs.map(p => p.name).join(", ")}) ──`)
    for (const pkg of pkgs) {
      console.log(`\nPublishing ${pkg.name}@${pkg.version}...`)
      const registry = await fetchRegistryVersion(pkg.name)

      if (registry === "fetch error") {
        if (dryRun) {
          console.log(
            "  (registry unreachable — dry-run treats this as a publish)",
          )
        } else {
          console.error(
            `  ✗ Could not check the registry for ${pkg.name}; aborting.`,
          )
          process.exit(1)
        }
      } else if (decidePublishAction(pkg.version, registry) === "skip") {
        console.log(`  Skipping ${pkg.name}@${pkg.version} (already published)`)
        skipped.push(`${pkg.name}@${pkg.version}`)
        continue
      }

      const dryRunFlag = dryRun ? " --dry-run" : ""
      const accessFlag = ` --access ${config.access ?? "public"}`
      try {
        run(`pnpm publish${accessFlag} --no-git-checks${dryRunFlag}`, {
          cwd: resolve(cwd, pkg.path),
        })
        published.push(pkg)
      } catch {
        console.error(`  ✗ Failed to publish ${pkg.name}@${pkg.version}`)
        failed.push(pkg.name)
      }
    }
  }

  // Summary
  console.log(`\n── Summary ──\n`)
  if (published.length > 0) {
    console.log(
      `  ${dryRun ? "[DRY RUN] " : ""}Published (${published.length}): ${published.map(p => `${p.name}@${p.version}`).join(", ")}`,
    )
  }
  if (skipped.length > 0) {
    console.log(`  Skipped (${skipped.length}): ${skipped.join(", ")}`)
  }
  if (failed.length > 0) {
    console.log(`  Failed (${failed.length}): ${failed.join(", ")}`)
    process.exit(1)
  }

  // 4. Tag the release
  const tags = computeTagPlan(published)
  if (tags.length === 0) {
    console.log("\nNothing new was published — no tag created.")
    return
  }

  console.log("\nStep 4/4: Tagging release...\n")
  for (const tagName of tags) {
    console.log(`\n  Creating tag ${tagName}...`)
    createTag(cwd, config, tagName, dryRun)
  }

  console.log()
}
