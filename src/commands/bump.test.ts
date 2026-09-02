import { describe, expect, it } from "vitest"
import { CONFIG, ENTRIES, ROOT, readFixture } from "../test-fixtures.js"
import { buildWorkspace } from "../workspace.js"
import { resolveBumpTargets } from "./bump.js"

const workspace = buildWorkspace(ENTRIES, CONFIG, ROOT, readFixture())

describe("resolveBumpTargets", () => {
  it("defaults to every publishable package except independents", () => {
    const { targets, skipped } = resolveBumpTargets(workspace, CONFIG)
    expect(targets.map(p => p.name)).toEqual(
      expect.arrayContaining([
        "@scope/a",
        "@scope/b",
        "@scope/react",
        "@scope/wire",
      ]),
    )
    expect(targets.map(p => p.name)).not.toContain("@scope/ind")
    expect(skipped.map(p => p.name)).toEqual(["@scope/ind"])
  })

  it("excludes independents from a group bump", () => {
    const { targets, skipped } = resolveBumpTargets(workspace, CONFIG, ["core"])
    expect(targets.map(p => p.name).sort()).toEqual([
      "@scope/a",
      "@scope/b",
      "@scope/wire",
    ])
    expect(skipped.map(p => p.name)).toEqual(["@scope/ind"])
  })

  it("includes an independent package when named explicitly", () => {
    const { targets } = resolveBumpTargets(workspace, CONFIG, ["@scope/ind"])
    expect(targets.map(p => p.name)).toEqual(["@scope/ind"])
  })

  it("no-ops on a configured group with no publishable members", () => {
    const { targets, emptyGroups } = resolveBumpTargets(workspace, CONFIG, [
      "experimental",
    ])
    expect(targets).toEqual([])
    expect(emptyGroups).toEqual(["experimental"])
  })

  it("throws on a name that is neither group nor package", () => {
    expect(() => resolveBumpTargets(workspace, CONFIG, ["nope"])).toThrow(
      /Unknown package or group "nope"/,
    )
  })

  it("deduplicates overlapping targets", () => {
    const { targets } = resolveBumpTargets(workspace, CONFIG, [
      "core",
      "@scope/a",
    ])
    expect(targets.filter(p => p.name === "@scope/a")).toHaveLength(1)
  })
})
