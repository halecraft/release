import { describe, expect, it } from "vitest"
import { CONFIG, ENTRIES, ROOT, readFixture } from "./test-fixtures.js"
import {
  buildWorkspace,
  computePublishTiers,
  type WorkspacePackage,
} from "./workspace.js"

describe("buildWorkspace", () => {
  const w = buildWorkspace(ENTRIES, CONFIG, ROOT, readFixture())

  it("skips a private root", () => {
    expect(w.all.some(p => p.name === "root")).toBe(false)
  })

  it("excludes private packages from publishable", () => {
    expect(w.publishable.map(p => p.name)).not.toContain("@scope/priv")
  })

  it("computes internalDeps from workspace names", () => {
    expect(w.all.find(p => p.name === "@scope/a")?.internalDeps).toEqual([
      "@scope/b",
    ])
  })

  it("assigns every matching group, not just the first", () => {
    const unnegated = buildWorkspace(
      ENTRIES,
      {
        ...CONFIG,
        groups: {
          core: { packages: ["packages/*", "packages/exchange/wire"] },
          bindings: { packages: ["packages/react"] },
        },
      },
      ROOT,
      readFixture(),
    )
    expect(
      unnegated.publishable.find(p => p.name === "@scope/react")?.groups,
    ).toEqual(["core", "bindings"])
  })

  it("honors negation patterns in group globs", () => {
    expect(w.publishable.find(p => p.name === "@scope/react")?.groups).toEqual([
      "bindings",
    ])
  })

  it("matches two-level paths only when a group lists them", () => {
    expect(w.publishable.find(p => p.name === "@scope/wire")?.groups).toEqual([
      "core",
    ])

    const shallow = buildWorkspace(
      ENTRIES,
      { ...CONFIG, groups: { core: { packages: ["packages/*"] } } },
      ROOT,
      readFixture(),
    )
    expect(
      shallow.publishable.find(p => p.name === "@scope/wire")?.groups,
    ).toEqual([])
  })

  it("reads the versioning policy from package.json", () => {
    expect(w.publishable.find(p => p.name === "@scope/ind")?.versioning).toBe(
      "independent",
    )
    expect(w.publishable.find(p => p.name === "@scope/a")?.versioning).toBe(
      "uniform",
    )
  })
})

function pkg(name: string, deps: string[] = []): WorkspacePackage {
  return {
    name,
    version: "1.0.0",
    path: `packages/${name}`,
    private: false,
    internalDeps: deps,
    groups: [],
    versioning: "uniform",
  }
}

describe("computePublishTiers", () => {
  it("puts leaf packages in tier 0", () => {
    const tiers = computePublishTiers([pkg("a"), pkg("b"), pkg("c", ["a"])])
    expect(tiers).toHaveLength(2)
    expect(tiers[0]?.map(p => p.name).sort()).toEqual(["a", "b"])
    expect(tiers[1]?.map(p => p.name)).toEqual(["c"])
  })

  it("produces one tier per package in a linear chain", () => {
    const tiers = computePublishTiers([
      pkg("c", ["b"]),
      pkg("b", ["a"]),
      pkg("a"),
    ])
    expect(tiers).toHaveLength(3)
    expect(tiers[0]?.[0]?.name).toBe("a")
    expect(tiers[1]?.[0]?.name).toBe("b")
    expect(tiers[2]?.[0]?.name).toBe("c")
  })

  it("resolves a diamond dependency", () => {
    const tiers = computePublishTiers([
      pkg("a"),
      pkg("b", ["a"]),
      pkg("c", ["a"]),
      pkg("d", ["b", "c"]),
    ])
    expect(tiers).toHaveLength(3)
    expect(tiers[0]?.map(p => p.name)).toEqual(["a"])
    expect(tiers[1]?.map(p => p.name).sort()).toEqual(["b", "c"])
    expect(tiers[2]?.map(p => p.name)).toEqual(["d"])
  })

  it("ignores dependencies on packages outside the set", () => {
    const tiers = computePublishTiers([
      pkg("a"),
      { ...pkg("c"), internalDeps: ["a", "external"] },
    ])
    expect(tiers).toHaveLength(2)
    expect(tiers[0]?.[0]?.name).toBe("a")
    expect(tiers[1]?.[0]?.name).toBe("c")
  })

  it("returns empty tiers for empty input", () => {
    expect(computePublishTiers([])).toEqual([])
  })

  it("puts independent packages in a single tier", () => {
    const tiers = computePublishTiers([pkg("a"), pkg("b"), pkg("c")])
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toHaveLength(3)
  })

  it("throws on a dependency cycle", () => {
    expect(() =>
      computePublishTiers([pkg("a", ["b"]), pkg("b", ["a"])]),
    ).toThrow(/cycle detected/i)
  })

  it("orders the real kyneta topology", () => {
    const k = (
      name: string,
      deps: string[] = [],
      path = `packages/${name}`,
    ): WorkspacePackage => ({
      name: `@kyneta/${name}`,
      version: "1.0.0",
      path,
      private: false,
      internalDeps: deps.map(d => `@kyneta/${d}`),
      groups: [],
      versioning: "uniform",
    })
    const packages = [
      k("changefeed"),
      k("machine"),
      k("schema", ["changefeed"]),
      k("compiler", ["changefeed", "schema"], "experimental/compiler"),
      k("index", ["changefeed", "schema"]),
      k(
        "loro-schema",
        ["changefeed", "schema"],
        "packages/schema/backends/loro",
      ),
      k("transport", ["machine", "schema"]),
      k("yjs-schema", ["changefeed", "schema"], "packages/schema/backends/yjs"),
      k("cast", ["changefeed", "compiler", "schema"], "experimental/cast"),
      k("exchange", ["transport", "changefeed", "schema"]),
      k("wire", ["transport"], "packages/exchange/wire"),
      k(
        "leveldb-store",
        ["exchange", "schema"],
        "packages/exchange/stores/leveldb",
      ),
      k("react", ["changefeed", "schema", "exchange"]),
      k(
        "sse-transport",
        ["machine", "transport", "wire"],
        "packages/exchange/transports/sse",
      ),
      k(
        "unix-socket-transport",
        ["transport", "machine", "wire"],
        "packages/exchange/transports/unix-socket",
      ),
      k(
        "webrtc-transport",
        ["transport", "wire"],
        "packages/exchange/transports/webrtc",
      ),
      k(
        "websocket-transport",
        ["transport", "machine", "wire"],
        "packages/exchange/transports/websocket",
      ),
    ]

    const tiers = computePublishTiers(packages)

    expect(tiers).toHaveLength(5)
    const tierNames = tiers.map(t => t.map(p => p.name).sort())
    expect(tierNames[0]).toEqual(["@kyneta/changefeed", "@kyneta/machine"])
    expect(tierNames[1]).toEqual(["@kyneta/schema"])
    expect(tierNames[2]).toEqual([
      "@kyneta/compiler",
      "@kyneta/index",
      "@kyneta/loro-schema",
      "@kyneta/transport",
      "@kyneta/yjs-schema",
    ])
    expect(tierNames[3]).toEqual([
      "@kyneta/cast",
      "@kyneta/exchange",
      "@kyneta/wire",
    ])
    expect(tierNames[4]).toEqual([
      "@kyneta/leveldb-store",
      "@kyneta/react",
      "@kyneta/sse-transport",
      "@kyneta/unix-socket-transport",
      "@kyneta/webrtc-transport",
      "@kyneta/websocket-transport",
    ])
  })
})
