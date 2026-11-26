import type { PrototypeVersion } from "../contracts/workbench.js";
/** Input is newest-first; preserve edits descended from this run's candidate. */
export function latestDescendant(versions: PrototypeVersion[], root: string) {
  const byId = new Map(versions.map((v) => [v.id, v]));
  return (
    versions.find((version) => {
      let id: string | null = version.id;
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        if (id === root) return true;
        seen.add(id);
        id = byId.get(id)?.baselineId ?? null;
      }
      return false;
    })?.id ?? root
  );
}
