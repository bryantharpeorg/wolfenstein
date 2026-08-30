/// <reference types="vite/client" />
// The reference lives here rather than in tsconfig.json's `types` because
// tsconfig.json is a shared file and this is the only module that needs it.
/**
 * Import every system's registration for side effect.
 *
 * `import.meta.glob(..., { eager: true })` is resolved by Vite at build time, so adding
 * `src/systems/<name>/register.ts` requires NO edit to any shared file — not this one,
 * not an index, not `main.ts`. That is the whole point: an index would still put every
 * story's one-line addition on adjacent lines of one file, which is a conflict.
 */
const modules = import.meta.glob('../systems/*/register.ts', { eager: true });

/** The module paths that were discovered, for diagnostics. */
export const discoveredSystemModules: string[] = Object.keys(modules).sort();
