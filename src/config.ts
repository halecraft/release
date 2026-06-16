import { createJiti } from "jiti"
import { resolve } from "node:path"
import { existsSync } from "node:fs"
import type { ReleaseConfig } from "./index.js"

export type ResolvedConfig = Required<Omit<ReleaseConfig, "groups" | "access">> & {
  groups?: Record<string, { packages: string[] }>
  access?: "public" | "restricted"
}

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const jiti = createJiti(import.meta.url)
  
  const configNames = [
    "release.config.ts",
    "release.config.js",
    "release.config.mjs",
    "release.config.cjs",
  ]

  let userConfig: ReleaseConfig = {}

  for (const name of configNames) {
    const configPath = resolve(cwd, name)
    if (existsSync(configPath)) {
      try {
        const mod = await jiti.import(configPath) as any
        userConfig = mod.default || mod
        break
      } catch (err) {
        console.error(`Error loading config ${name}:`, err)
      }
    }
  }

  return {
    groups: userConfig.groups,
    remotes: userConfig.remotes ?? ["origin"],
    buildCommand: userConfig.buildCommand ?? "pnpm build",
    testCommand: userConfig.testCommand ?? "pnpm test",
    access: userConfig.access,
  }
}
