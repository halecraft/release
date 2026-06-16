import type { ResolvedConfig } from "../config.js"
import { discoverWorkspace } from "../workspace.js"

export async function status(cwd: string, config: ResolvedConfig): Promise<void> {
  console.log("\nPackage Status\n")

  const workspace = discoverWorkspace(cwd, config)

  // If no groups are defined, just list all publishable packages
  if (workspace.groups.size === 0) {
    await printPackages(workspace.publishable)
  } else {
    for (const [groupName, pkgs] of [...workspace.groups.entries()].sort(
      ([a], [b]) => a.localeCompare(b)
    )) {
      console.log(`  ${groupName}:`)
      await printPackages(pkgs, "    ")
      console.log()
    }
  }
}

async function printPackages(pkgs: { name: string; version: string }[], indent = "  ") {
  for (const pkg of pkgs) {
    let registryVersion: string
    try {
      const resp = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/latest`
      )
      if (resp.ok) {
        const data = (await resp.json()) as { version: string }
        registryVersion = data.version
      } else {
        registryVersion = "not published"
      }
    } catch {
      registryVersion = "fetch error"
    }

    const marker =
      registryVersion === "not published"
        ? "○"
        : pkg.version === registryVersion
        ? "✓"
        : "↑"
    console.log(
      `${indent}${marker} ${pkg.name.padEnd(42)} local: ${pkg.version.padEnd(
        10
      )} npm: ${registryVersion}`
    )
  }
}
