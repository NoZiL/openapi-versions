/**
 * Spike #124: open enums on the Hey API path, as `$resolvers` on `@hey-api/typescript`.
 * `x-extensible-enum` becomes `"a" | "b" | (string & {})`, built with Hey API's own type DSL, so its
 * printer adds parentheses inside arrays and intersections (the ADR 0019 problem does not arise).
 *
 * - `string`: a plain extensible string.
 * - `union`: a nullable one. Hey API splits `type: ["string","null"]` (3.1) or `nullable: true` (3.0)
 *   into a union whose string member has lost the extension; the parent schema still has it.
 */
const values = (schema: any): string[] | undefined => {
  const v = schema?.["x-extensible-enum"];
  return Array.isArray(v) && v.every((x: unknown) => typeof x === "string") ? v : undefined;
};

const openUnion = ($: any, vals: string[], ...extra: any[]) =>
  $.type.or(...vals.map((v) => $.type.literal(v)), $.type.and($.type("string"), $.type.object()), ...extra);

export const openEnumsHeyApi = {
  string: (ctx: any) => {
    const vals = values(ctx.schema);
    return vals && openUnion(ctx.$, vals);
  },
  union: (ctx: any) => {
    const vals = values(ctx.parentSchema);
    const items: any[] = ctx.parentSchema.items ?? [];
    if (!vals || !items.some((i) => i.type === "string") || !items.every((i) => i.type === "string" || i.type === "null")) return undefined;
    return openUnion(ctx.$, vals, ...(items.some((i) => i.type === "null") ? [ctx.$.type("null")] : []));
  },
};
