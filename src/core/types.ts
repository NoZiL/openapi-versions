/**
 * The methods a path item can have. Same union as `HttpMethod` in openapi-typescript-helpers and
 * openapi-typesafe-helpers, written out so the runtime does not depend on either (ADR 0017).
 */
type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

/**
 * `paths` with the gated operations removed (turned into `method?: never`, exactly how
 * openapi-typescript marks a method a path does not have). A client typed with this
 * cannot call an operation newer than the floor: TypeScript rejects it, so every call
 * to a newer operation has to go through the gated client, next to a capability check.
 */
export type StripOps<P, Ops extends string> = {
  [Path in keyof P]: {
    [K in keyof P[Path] as K extends HttpMethod ? (`${K} ${Path & string}` extends Ops ? never : K) : K]: P[Path][K];
  } & {
    [K in HttpMethod as `${K} ${Path & string}` extends Ops ? K : never]?: never;
  };
};

/** "get /users/{id}" from a method and a path, matching the keys of the generated since maps */
export type OpKey<M extends string, P extends string> = `${M} ${P}`;
