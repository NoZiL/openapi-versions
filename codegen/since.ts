/**
 * For each operation and each component-schema property, find the first version
 * that has it. Only things introduced AFTER the floor are "gated": everything at
 * the floor is guaranteed on every supported backend.
 */
import semver from "semver";

export interface VersionedDoc {
  version: string;
  doc: any;
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export function computeSince(group: VersionedDoc[], floor: string) {
  const sorted = [...group].sort((a, b) => semver.compare(a.version, b.version));
  const ops: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const schemas: Record<string, string> = {};
  const seen = new Set<string>();

  for (const { version, doc } of sorted) {
    for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
      for (const m of METHODS) if (item?.[m]) ops[`${m} ${path}`] ??= version;
    }
    for (const [name, schema] of Object.entries<any>(doc.components?.schemas ?? {})) {
      schemas[name] ??= version;
      for (const prop of Object.keys(schema?.properties ?? {})) {
        const key = `${name}.${prop}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // fields born with their schema are covered by the operation that returns the schema
        if (semver.gt(version, schemas[name])) fields[key] = version;
      }
    }
  }

  const gated = (m: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(m)
        .filter(([, v]) => semver.gt(v, floor))
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  return { ops: Object.keys(ops).sort(), gatedOps: gated(ops), gatedFields: gated(fields) };
}
