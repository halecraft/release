#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from "util";

// src/commands/bump.ts
import { readFileSync as readFileSync2, writeFileSync } from "fs";
import { resolve as resolve2 } from "path";

// src/workspace.ts
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { relative, resolve } from "path";
import picomatch from "picomatch";
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function versioningOf(pkgJson) {
  return pkgJson.versioning === "independent" ? "independent" : "uniform";
}
function matchesAny(relPath, patterns) {
  return patterns.some((pattern) => picomatch.isMatch(relPath, pattern));
}
function matchesGroup(relPath, patterns) {
  const positives = patterns.filter((p) => !p.startsWith("!"));
  const negations = patterns.filter((p) => p.startsWith("!"));
  if (!matchesAny(relPath, positives)) return false;
  return !matchesAny(
    relPath,
    negations.map((p) => p.slice(1))
  );
}
function discoverWorkspace(cwd, config) {
  const raw = execSync("pnpm ls -r --depth -1 --json", {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  const entries = JSON.parse(raw);
  return buildWorkspace(entries, config, cwd);
}
function buildWorkspace(entries, config, root, readPkgJson = readJson) {
  const workspaceNames = new Set(entries.map((e) => e.name));
  const all = [];
  for (const entry of entries) {
    if (resolve(entry.path) === resolve(root) && (entry.private ?? false)) {
      continue;
    }
    const relPath = relative(root, resolve(entry.path));
    const pkgJson = readPkgJson(resolve(entry.path, "package.json"));
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
        if (matchesGroup(relPath, groupDef.packages)) {
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
      groups: matchedGroups,
      versioning: versioningOf(pkgJson)
    });
  }
  const publishable = all.filter((p) => !p.private);
  const groups = /* @__PURE__ */ new Map();
  for (const pkg of publishable) {
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
      const children = dependents.get(dep);
      if (children) {
        children.push(pkg.name);
        inDegree.set(pkg.name, (inDegree.get(pkg.name) ?? 0) + 1);
      }
    }
  }
  const tiers = [];
  let queue = packages.filter((p) => (inDegree.get(p.name) ?? 0) === 0).sort((a, b) => a.name.localeCompare(b.name));
  while (queue.length > 0) {
    tiers.push(queue);
    const next = [];
    for (const pkg of queue) {
      for (const child of dependents.get(pkg.name) ?? []) {
        const newDegree = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) {
          const ready = nameToPackage.get(child);
          if (ready) next.push(ready);
        }
      }
    }
    queue = next.sort((a, b) => a.name.localeCompare(b.name));
  }
  const stuck = packages.filter((p) => (inDegree.get(p.name) ?? 0) > 0);
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
function resolveBumpTargets(workspace, config, packagesFlag) {
  const targets = [];
  const skipped = [];
  const emptyGroups = [];
  if (packagesFlag && packagesFlag.length > 0) {
    for (const name of packagesFlag) {
      if (config.groups?.[name] !== void 0) {
        const members = workspace.groups.get(name) ?? [];
        if (members.length === 0) {
          emptyGroups.push(name);
          continue;
        }
        for (const member of members) {
          if (member.versioning === "independent") {
            skipped.push(member);
          } else {
            targets.push(member);
          }
        }
      } else {
        const pkg = workspace.publishable.find((p) => p.name === name);
        if (pkg) {
          targets.push(pkg);
        } else {
          throw new Error(`Unknown package or group "${name}"`);
        }
      }
    }
  } else {
    for (const pkg of workspace.publishable) {
      if (pkg.versioning === "independent") {
        skipped.push(pkg);
      } else {
        targets.push(pkg);
      }
    }
  }
  return {
    targets: dedupeByName(targets),
    skipped: dedupeByName(skipped),
    emptyGroups: [...new Set(emptyGroups)]
  };
}
function dedupeByName(pkgs) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const pkg of pkgs) {
    if (!seen.has(pkg.name)) {
      seen.add(pkg.name);
      out.push(pkg);
    }
  }
  return out;
}
function bump(cwd, version, config, packagesFlag) {
  if (!isValidSemver(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }
  const workspace = discoverWorkspace(cwd, config);
  let plan;
  try {
    plan = resolveBumpTargets(workspace, config, packagesFlag);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
  for (const name of plan.emptyGroups) {
    console.log(`No publishable packages in group ${name}.`);
  }
  for (const pkg of plan.skipped) {
    console.log(`  Skipping ${pkg.name} (independent versioning)`);
  }
  if (plan.targets.length === 0) {
    console.log("No packages to bump.");
    return;
  }
  console.log(`
Bumping to ${version}:
`);
  for (const pkg of plan.targets) {
    const pkgPath = resolve2(cwd, pkg.path, "package.json");
    const pkgJson = readJson2(pkgPath);
    const oldVersion = pkgJson.version;
    pkgJson.version = version;
    writeJson(pkgPath, pkgJson);
    console.log(`  ${pkg.name}: ${oldVersion} \u2192 ${version}`);
  }
  console.log(`
Done. Bumped ${plan.targets.length} package(s).
`);
}

// src/commands/publish.ts
import { execSync as execSync2 } from "child_process";
import { resolve as resolve3 } from "path";

// src/registry.ts
async function fetchRegistryVersion(name) {
  try {
    const resp = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
    );
    if (resp.ok) {
      const data = await resp.json();
      return data.version;
    }
    return "not published";
  } catch {
    return "fetch error";
  }
}

// src/commands/publish.ts
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
    const user = execSync2("pnpm whoami", {
      cwd,
      encoding: "utf8"
    }).trim();
    console.log(`  Logged in as: ${user}
`);
  } catch {
    console.error("Error: Not logged in. Run `pnpm login` first.\n");
    process.exit(1);
  }
}
function decidePublishAction(local, registry) {
  return registry === local ? "skip" : "publish";
}
function computeTagPlan(released) {
  if (released.length === 0) return [];
  const train = released.filter((p) => p.versioning === "uniform");
  const trainVersions = new Set(train.map((p) => p.version));
  if (train.length > 0 && trainVersions.size === 1) {
    return [
      `v${train[0].version}`,
      ...released.filter((p) => p.versioning === "independent").map((p) => `${p.name}@${p.version}`)
    ];
  }
  return released.map((p) => `${p.name}@${p.version}`);
}
function createTag(cwd, config, tagName, dryRun) {
  if (dryRun) {
    run(`git tag ${tagName}`, { dryRun });
    for (const remote of config.remotes) {
      run(`git push ${remote} ${tagName}`, { dryRun });
    }
    return;
  }
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
        `Error: tag ${tagName} already exists on commit ${tagCommit.slice(0, 8)}, but HEAD is ${headCommit.slice(0, 8)}.`
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
async function publish(cwd, config, dryRun) {
  console.log(`
${dryRun ? "[DRY RUN] " : ""}Publishing packages
`);
  const workspace = discoverWorkspace(cwd, config);
  const tiers = computePublishTiers(workspace.publishable);
  if (!dryRun) {
    checkNpmAuth(cwd);
  }
  console.log("Step 1/4: Building all packages...\n");
  run(config.buildCommand, { cwd });
  console.log("\nStep 2/4: Running tests...\n");
  run(config.testCommand, { cwd });
  if (workspace.publishable.length === 0) {
    console.log("No publishable packages found. Nothing to publish.\n");
    return;
  }
  console.log("\nStep 3/4: Publishing in dependency order...\n");
  const published = [];
  const skipped = [];
  const failed = [];
  for (let tier = 0; tier < tiers.length; tier++) {
    const pkgs = tiers[tier];
    console.log(`
\u2500\u2500 Tier ${tier} (${pkgs.map((p) => p.name).join(", ")}) \u2500\u2500`);
    for (const pkg of pkgs) {
      console.log(`
Publishing ${pkg.name}@${pkg.version}...`);
      const registry = await fetchRegistryVersion(pkg.name);
      if (registry === "fetch error") {
        if (dryRun) {
          console.log(
            "  (registry unreachable \u2014 dry-run treats this as a publish)"
          );
        } else {
          console.error(
            `  \u2717 Could not check the registry for ${pkg.name}; aborting.`
          );
          process.exit(1);
        }
      } else if (decidePublishAction(pkg.version, registry) === "skip") {
        console.log(`  Skipping ${pkg.name}@${pkg.version} (already published)`);
        skipped.push(`${pkg.name}@${pkg.version}`);
        continue;
      }
      const dryRunFlag = dryRun ? " --dry-run" : "";
      const accessFlag = ` --access ${config.access ?? "public"}`;
      try {
        run(`pnpm publish${accessFlag} --no-git-checks${dryRunFlag}`, {
          cwd: resolve3(cwd, pkg.path)
        });
        published.push(pkg);
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
      `  ${dryRun ? "[DRY RUN] " : ""}Published (${published.length}): ${published.map((p) => `${p.name}@${p.version}`).join(", ")}`
    );
  }
  if (skipped.length > 0) {
    console.log(`  Skipped (${skipped.length}): ${skipped.join(", ")}`);
  }
  if (failed.length > 0) {
    console.log(`  Failed (${failed.length}): ${failed.join(", ")}`);
    process.exit(1);
  }
  const tags = computeTagPlan(published);
  if (tags.length === 0) {
    console.log("\nNothing new was published \u2014 no tag created.");
    return;
  }
  console.log("\nStep 4/4: Tagging release...\n");
  for (const tagName of tags) {
    console.log(`
  Creating tag ${tagName}...`);
    createTag(cwd, config, tagName, dryRun);
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
    const registryVersion = await fetchRegistryVersion(pkg.name);
    const marker = registryVersion === "not published" ? "\u25CB" : registryVersion === "fetch error" ? "?" : pkg.version === registryVersion ? "\u2713" : "\u2191";
    const independent = pkg.versioning === "independent" ? "  [independent]" : "";
    console.log(
      `${indent}${marker} ${pkg.name.padEnd(42)} local: ${pkg.version.padEnd(10)} npm: ${registryVersion}${independent}`
    );
  }
}

// src/config.ts
import { existsSync } from "fs";
import { resolve as resolve4 } from "path";
import { createJiti } from "jiti";
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
    const configPath = resolve4(cwd, name);
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
      await publish(cwd, config, !!values["dry-run"]);
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
