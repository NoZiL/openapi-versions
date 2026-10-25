import type { HttpMethod } from "openapi-typescript-helpers";

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
