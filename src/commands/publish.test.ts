import { describe, expect, it } from "vitest"
import type { WorkspacePackage } from "../workspace.js"
import { computeTagPlan, decidePublishAction } from "./publish.js"

function pkg(
  name: string,
  version: string,
  versioning: "uniform" | "independent" = "uniform",
): WorkspacePackage {
  return {
    name,
    version,
    path: `packages/${name}`,
    private: false,
    internalDeps: [],
    groups: [],
    versioning,
  }
}

describe("decidePublishAction", () => {
  it("skips when the registry already has the local version", () => {
    expect(decidePublishAction("1.0.0", "1.0.0")).toBe("skip")
  })

  it("publishes when the local version is newer", () => {
    expect(decidePublishAction("1.0.1", "1.0.0")).toBe("publish")
  })

  it("publishes when the package is not on the registry", () => {
    expect(decidePublishAction("1.0.0", "not published")).toBe("publish")
  })
})

describe("computeTagPlan", () => {
  it("returns no tags when nothing was published", () => {
    expect(computeTagPlan([])).toEqual([])
  })

  it("tags the train with v<version> when it releases at one version", () => {
    const released = [pkg("@scope/a", "3.1.0"), pkg("@scope/b", "3.1.0")]
    expect(computeTagPlan(released)).toEqual(["v3.1.0"])
  })

  it("tags a lone independent package per-package", () => {
    const released = [pkg("@kyneta/perspective", "0.1.0", "independent")]
    expect(computeTagPlan(released)).toEqual(["@kyneta/perspective@0.1.0"])
  })

  it("tags the train and every independent package when both ship", () => {
    const released = [
      pkg("@scope/a", "3.1.0"),
      pkg("@kyneta/perspective", "0.2.0", "independent"),
    ]
    expect(computeTagPlan(released)).toEqual([
      "v3.1.0",
      "@kyneta/perspective@0.2.0",
    ])
  })

  it("tags every package explicitly when the train is mixed-version", () => {
    const released = [pkg("@scope/a", "3.1.1"), pkg("@scope/b", "3.1.0")]
    expect(computeTagPlan(released)).toEqual([
      "@scope/a@3.1.1",
      "@scope/b@3.1.0",
    ])
  })
})
