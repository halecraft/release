import type { ResolvedConfig } from "../config.js"
import { fetchRegistryVersion } from "../registry.js"
import { discoverWorkspace, type WorkspacePackage } from "../workspace.js"

export async function status(
  cwd: string,
  config: ResolvedConfig,
): Promise<void> {
  console.log("\nPackage Status\n")

  const workspace = discoverWorkspace(cwd, config)

  // If no groups are defined, just list all publishable packages
  if (workspace.groups.size === 0) {
    await printPackages(workspace.publishable)
  } else {
    for (const [groupName, pkgs] of [...workspace.groups.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      console.log(`  ${groupName}:`)
      await printPackages(pkgs, "    ")
      console.log()
    }
  }
}

async function printPackages(
  pkgs: WorkspacePackage[],
  indent = "  ",
): Promise<void> {
  for (const pkg of pkgs) {
    const registryVersion = await fetchRegistryVersion(pkg.name)

    const marker =
      registryVersion === "not published"
        ? "○"
        : registryVersion === "fetch error"
          ? "?"
          : pkg.version === registryVersion
            ? "✓"
            : "↑"
    const independent =
      pkg.versioning === "independent" ? "  [independent]" : ""
    console.log(
      `${indent}${marker} ${pkg.name.padEnd(42)} local: ${pkg.version.padEnd(10)} npm: ${registryVersion}${independent}`,
    )
  }
}
