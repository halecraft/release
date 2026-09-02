/** The latest published version of a package, or why we could not learn it. */
export type RegistryStatus = string | "not published" | "fetch error"

/** Query the npm registry for a package's latest published version. */
export async function fetchRegistryVersion(
  name: string,
): Promise<RegistryStatus> {
  try {
    const resp = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
    )
    if (resp.ok) {
      const data = (await resp.json()) as { version: string }
      return data.version
    }
    return "not published"
  } catch {
    return "fetch error"
  }
}
