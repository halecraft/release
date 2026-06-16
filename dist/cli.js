#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from "util";

// src/config.ts
import { createJiti } from "jiti";
import { resolve } from "path";
import { existsSync } from "fs";
async function loadConfig(cwd) {
  const jiti = createJiti(import.meta.url);
  const configNames = [
    "release.config.ts",
    "release.config.js",
    "release.config.mjs",
    "release.config.cjs"
  ];
  let userConfig = {};
  for (const name of configNames) {
    const configPath = resolve(cwd, name);
    if (existsSync(configPath)) {
      try {
        const mod = await jiti.import(configPath);
        userConfig = mod.default || mod;
        break;
      } catch (err) {
        console.error(`Error loading config ${name}:`, err);
      }
    }
  }
  return {
    groups: userConfig.groups,
    remotes: userConfig.remotes ?? ["origin"],
    buildCommand: userConfig.buildCommand ?? "pnpm build",
    testCommand: userConfig.testCommand ?? "pnpm test",
    access: userConfig.access
  };
}

// src/commands/bump.ts
import { readFileSync as readFileSync2, writeFileSync } from "fs";
import { resolve as resolve3 } from "path";

// src/workspace.ts
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve as resolve2, relative } from "path";
import picomatch from "picomatch";
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function discoverWorkspace(cwd, config) {
  const raw = execSync("pnpm ls -r --depth -1 --json", {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  const entries = JSON.parse(raw);
  const workspaceNames = new Set(entries.map((e) => e.name));
  const all = [];
  for (const entry of entries) {
    if (resolve2(entry.path) === resolve2(cwd) && (entry.private ?? false)) continue;
    const relPath = relative(cwd, resolve2(entry.path));
    const pkgJson = readJson(resolve2(entry.path, "package.json"));
    const deps = pkgJson.dependencies;
    const peerDeps = pkgJson.peerDependencies;
    const internalDeps = [
      .../* @__PURE__ */ new Set([
        ...Object.keys(deps ?? {}).filter((k) => workspaceNames.has(k)),
        ...Object.keys(peerDeps ?? {}).filter((k) => workspaceNames.has(k))
      ])
    ].sort();
    const matchedGroups = [];
    if (config.groups) {
      for (const [groupName, groupDef] of Object.entries(config.groups)) {
        const isMatch = picomatch.isMatch(relPath, groupDef.packages);
        if (isMatch) {
          matchedGroups.push(groupName);
        }
      }
    }
    all.push({
      name: entry.name,
      version: pkgJson.version ?? "0.0.0",
      path: relPath,
      private: entry.private ?? false,
      internalDeps,
      groups: matchedGroups
    });
  }
  const publishable = all.filter((p) => !p.private);
  const groups = /* @__PURE__ */ new Map();
  for (const pkg of publishable) {
    if (pkg.groups.length === 0) {
    }
    for (const g of pkg.groups) {
      const existing = groups.get(g);
      if (existing) {
        existing.push(pkg);
      } else {
        groups.set(g, [pkg]);
      }
    }
  }
  for (const pkgs of groups.values()) {
    pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { all, publishable, groups };
}
function computePublishTiers(packages) {
  const nameToPackage = new Map(packages.map((p) => [p.name, p]));
  const inDegree = new Map(packages.map((p) => [p.name, 0]));
  const dependents = new Map(packages.map((p) => [p.name, []]));
  for (const pkg of packages) {
    for (const dep of pkg.internalDeps) {
      if (nameToPackage.has(dep)) {
        dependents.get(dep).push(pkg.name);
        inDegree.set(pkg.name, inDegree.get(pkg.name) + 1);
      }
    }
  }
  const tiers = [];
  let queue = packages.filter((p) => inDegree.get(p.name) === 0).sort((a, b) => a.name.localeCompare(b.name));
  while (queue.length > 0) {
    tiers.push(queue);
    const next = [];
    for (const pkg of queue) {
      for (const child of dependents.get(pkg.name)) {
        const newDegree = inDegree.get(child) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) {
          next.push(nameToPackage.get(child));
        }
      }
    }
    queue = next.sort((a, b) => a.name.localeCompare(b.name));
  }
  const stuck = packages.filter((p) => inDegree.get(p.name) > 0);
  if (stuck.length > 0) {
    const names = stuck.map((p) => p.name).join(", ");
    throw new Error(`Dependency cycle detected among: ${names}`);
  }
  return tiers;
}

// src/commands/bump.ts
function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}
function readJson2(path) {
  return JSON.parse(readFileSync2(path, "utf8"));
}
function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
function bump(cwd, version, config, packagesFlag) {
  if (!isValidSemver(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }
  const workspace = discoverWorkspace(cwd, config);
  let targets = [];
  if (packagesFlag && packagesFlag.length > 0) {
    for (const name of packagesFlag) {
      if (workspace.groups.has(name)) {
        targets.push(...workspace.groups.get(name));
      } else {
        const pkg = workspace.publishable.find((p) => p.name === name);
        if (pkg) {
          targets.push(pkg);
        } else {
          console.error(`Error: Unknown package or group "${name}"`);
          process.exit(1);
        }
      }
    }
    targets = [...new Set(targets)];
  } else {
    targets = workspace.publishable;
  }
  if (targets.length === 0) {
    console.log("No packages to bump.");
    return;
  }
  console.log(`
Bumping to ${version}:
`);
  for (const pkg of targets) {
    const pkgPath = resolve3(cwd, pkg.path, "package.json");
    const pkgJson = readJson2(pkgPath);
    const oldVersion = pkgJson.version;
    pkgJson.version = version;
    writeJson(pkgPath, pkgJson);
    console.log(`  ${pkg.name}: ${oldVersion} \u2192 ${version}`);
  }
  console.log(`
Done. Bumped ${targets.length} package(s).
`);
}

// src/commands/publish.ts
import { execSync as execSync2 } from "child_process";
import { resolve as resolve4 } from "path";
function run(cmd, opts) {
  if (opts?.dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return;
  }
  console.log(`  $ ${cmd}`);
  execSync2(cmd, { cwd: opts?.cwd, stdio: "inherit" });
}
function checkNpmAuth(cwd) {
  console.log("Checking npm authentication...\n");
  try {
    const user = execSync2("npm whoami", {
      cwd,
      encoding: "utf8"
    }).trim();
    console.log(`  Logged in as: ${user}
`);
  } catch {
    console.error("Error: Not logged in to npm. Run `npm login` first.\n");
    process.exit(1);
  }
}
function publish(cwd, config, dryRun) {
  console.log(`
${dryRun ? "[DRY RUN] " : ""}Publishing packages
`);
  const workspace = discoverWorkspace(cwd, config);
  const tiers = computePublishTiers(workspace.publishable);
  checkNpmAuth(cwd);
  console.log("Step 1/4: Building all packages...\n");
  run(config.buildCommand, { cwd });
  console.log("\nStep 2/4: Running tests...\n");
  run(config.testCommand, { cwd });
  if (workspace.publishable.length === 0) {
    console.log("No publishable packages found. Nothing to publish.\n");
    return;
  }
  const version = workspace.publishable[0].version;
  console.log("\nStep 3/4: Publishing in dependency order...\n");
  const published = [];
  const failed = [];
  for (let tier = 0; tier < tiers.length; tier++) {
    const pkgs = tiers[tier];
    console.log(`
\u2500\u2500 Tier ${tier} (${pkgs.map((p) => p.name).join(", ")}) \u2500\u2500`);
    for (const pkg of pkgs) {
      console.log(`
Publishing ${pkg.name}@${pkg.version}...`);
      const dryRunFlag = dryRun ? " --dry-run" : "";
      const accessFlag = config.access ? ` --access ${config.access}` : "";
      try {
        run(`pnpm publish${accessFlag} --no-git-checks${dryRunFlag}`, {
          cwd: resolve4(cwd, pkg.path)
        });
        published.push(pkg.name);
      } catch {
        console.error(`  \u2717 Failed to publish ${pkg.name}@${pkg.version}`);
        failed.push(pkg.name);
      }
    }
  }
  console.log(`
\u2500\u2500 Summary \u2500\u2500
`);
  if (published.length > 0) {
    console.log(
      `  ${dryRun ? "[DRY RUN] " : ""}Published (${published.length}): ${published.join(", ")}`
    );
  }
  if (failed.length > 0) {
    console.log(`  Failed (${failed.length}): ${failed.join(", ")}`);
    process.exit(1);
  }
  const tagName = `v${version}`;
  console.log(`
Step 4/4: Tagging release as ${tagName}...
`);
  if (dryRun) {
    run(`git tag ${tagName}`, { dryRun });
    for (const remote of config.remotes) {
      run(`git push ${remote} ${tagName}`, { dryRun });
    }
  } else {
    const existingTag = execSync2(`git tag -l "${tagName}"`, {
      cwd,
      encoding: "utf8"
    }).trim();
    if (existingTag) {
      const tagCommit = execSync2(`git rev-list -n 1 "${tagName}"`, {
        cwd,
        encoding: "utf8"
      }).trim();
      const headCommit = execSync2("git rev-parse HEAD", {
        cwd,
        encoding: "utf8"
      }).trim();
      if (tagCommit === headCommit) {
        console.log(`  Tag ${tagName} already exists on HEAD, skipping.`);
      } else {
        console.error(
          `Error: tag ${tagName} already exists on commit ${tagCommit.slice(
            0,
            8
          )}, but HEAD is ${headCommit.slice(0, 8)}.`
        );
        console.error("Delete the existing tag or use a different version.");
        process.exit(1);
      }
    } else {
      run(`git tag ${tagName}`, { cwd });
      for (const remote of config.remotes) {
        run(`git push ${remote} ${tagName}`, { cwd });
      }
    }
  }
  console.log();
}

// src/commands/status.ts
async function status(cwd, config) {
  console.log("\nPackage Status\n");
  const workspace = discoverWorkspace(cwd, config);
  if (workspace.groups.size === 0) {
    await printPackages(workspace.publishable);
  } else {
    for (const [groupName, pkgs] of [...workspace.groups.entries()].sort(
      ([a], [b]) => a.localeCompare(b)
    )) {
      console.log(`  ${groupName}:`);
      await printPackages(pkgs, "    ");
      console.log();
    }
  }
}
async function printPackages(pkgs, indent = "  ") {
  for (const pkg of pkgs) {
    let registryVersion;
    try {
      const resp = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/latest`
      );
      if (resp.ok) {
        const data = await resp.json();
        registryVersion = data.version;
      } else {
        registryVersion = "not published";
      }
    } catch {
      registryVersion = "fetch error";
    }
    const marker = registryVersion === "not published" ? "\u25CB" : pkg.version === registryVersion ? "\u2713" : "\u2191";
    console.log(
      `${indent}${marker} ${pkg.name.padEnd(42)} local: ${pkg.version.padEnd(
        10
      )} npm: ${registryVersion}`
    );
  }
}

// src/cli.ts
async function main() {
  const args = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    options: {
      packages: {
        type: "string",
        multiple: true
      },
      "dry-run": {
        type: "boolean"
      },
      remotes: {
        type: "string"
      },
      "build-command": {
        type: "string"
      },
      "test-command": {
        type: "string"
      },
      access: {
        type: "string"
      }
    },
    allowPositionals: true
  });
  const command = positionals[0];
  if (!command) {
    usage();
  }
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  if (values.remotes) {
    config.remotes = values.remotes.split(",").map((s) => s.trim());
  }
  if (values["build-command"]) {
    config.buildCommand = values["build-command"];
  }
  if (values["test-command"]) {
    config.testCommand = values["test-command"];
  }
  if (values.access === "public" || values.access === "restricted") {
    config.access = values.access;
  }
  switch (command) {
    case "bump": {
      const version = positionals[1];
      if (!version) {
        console.error("Error: version argument required");
        usage();
      }
      bump(cwd, version, config, values.packages);
      break;
    }
    case "publish": {
      publish(cwd, config, !!values["dry-run"]);
      break;
    }
    case "status": {
      await status(cwd, config);
      break;
    }
    default:
      console.error(`Unknown command: ${command}
`);
      usage();
  }
}
function usage() {
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
`);
  process.exit(1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
