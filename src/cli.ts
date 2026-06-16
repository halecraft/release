#!/usr/bin/env node

import { parseArgs } from "node:util"
import { loadConfig } from "./config.js"
import { bump } from "./commands/bump.js"
import { publish } from "./commands/publish.js"
import { status } from "./commands/status.js"

async function main() {
  const args = process.argv.slice(2)

  const { values, positionals } = parseArgs({
    args,
    options: {
      packages: {
        type: "string",
        multiple: true,
      },
      "dry-run": {
        type: "boolean",
      },
      remotes: {
        type: "string",
      },
      "build-command": {
        type: "string",
      },
      "test-command": {
        type: "string",
      },
      access: {
        type: "string",
      },
    },
    allowPositionals: true,
  })

  const command = positionals[0]
  if (!command) {
    usage()
  }

  const cwd = process.cwd()
  const config = await loadConfig(cwd)

  // Merge CLI flags into config
  if (values.remotes) {
    config.remotes = values.remotes.split(",").map((s) => s.trim())
  }
  if (values["build-command"]) {
    config.buildCommand = values["build-command"]
  }
  if (values["test-command"]) {
    config.testCommand = values["test-command"]
  }
  if (values.access === "public" || values.access === "restricted") {
    config.access = values.access
  }

  switch (command) {
    case "bump": {
      const version = positionals[1]
      if (!version) {
        console.error("Error: version argument required")
        usage()
      }
      bump(cwd, version, config, values.packages)
      break
    }
    case "publish": {
      publish(cwd, config, !!values["dry-run"])
      break
    }
    case "status": {
      await status(cwd, config)
      break
    }
    default:
      console.error(`Unknown command: ${command}\n`)
      usage()
  }
}

function usage(): never {
  console.log(`
Usage:
  release bump <version> [--packages <pkg1> <pkg2>...]
  release publish [--dry-run]
  release status

Options:
  --packages <name>      Specific packages or groups to bump (can be used multiple times)
  --dry-run              Run publish without actually publishing or pushing tags
  --remotes <remotes>    Comma-separated list of git remotes to push tags to (e.g. origin,github)
  --build-command <cmd>  Command to build packages (default: "pnpm build")
  --test-command <cmd>   Command to test packages (default: "pnpm test")
  --access <level>       npm access level ("public" or "restricted")
`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
