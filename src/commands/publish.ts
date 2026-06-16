import { execSync } from "node:child_process"
import { resolve } from "node:path"
import type { ResolvedConfig } from "../config.js"
import { discoverWorkspace, computePublishTiers } from "../workspace.js"

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
    const user = execSync("npm whoami", {
      cwd,
      encoding: "utf8",
    }).trim()
    console.log(`  Logged in as: ${user}\n`)
  } catch {
    console.error("Error: Not logged in to npm. Run `npm login` first.\n")
    process.exit(1)
  }
}

export function publish(cwd: string, config: ResolvedConfig, dryRun: boolean): void {
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

  const version = workspace.publishable[0].version

  // 3. Publish in tier order
  console.log("\nStep 3/4: Publishing in dependency order...\n")
  const published: string[] = []
  const failed: string[] = []

  for (let tier = 0; tier < tiers.length; tier++) {
    const pkgs = tiers[tier]
    console.log(`\n── Tier ${tier} (${pkgs.map((p) => p.name).join(", ")}) ──`)
    for (const pkg of pkgs) {
      console.log(`\nPublishing ${pkg.name}@${pkg.version}...`)
      const dryRunFlag = dryRun ? " --dry-run" : ""
      // Default to public access for all publishable (non-private) packages
      const accessFlag = ` --access ${config.access ?? "public"}`
      try {
        run(`pnpm publish${accessFlag} --no-git-checks${dryRunFlag}`, {
          cwd: resolve(cwd, pkg.path),
        })
        published.push(pkg.name)
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
      `  ${dryRun ? "[DRY RUN] " : ""}Published (${published.length}): ${published.join(", ")}`
    )
  }
  if (failed.length > 0) {
    console.log(`  Failed (${failed.length}): ${failed.join(", ")}`)
    process.exit(1)
  }

  // 4. Tag the release
  const tagName = `v${version}`
  console.log(`\nStep 4/4: Tagging release as ${tagName}...\n`)

  if (dryRun) {
    run(`git tag ${tagName}`, { dryRun })
    for (const remote of config.remotes) {
      run(`git push ${remote} ${tagName}`, { dryRun })
    }
  } else {
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
          `Error: tag ${tagName} already exists on commit ${tagCommit.slice(
            0,
            8
          )}, but HEAD is ${headCommit.slice(0, 8)}.`
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

  console.log()
}
