/// <reference types="vite/client" />
// Extra `validateLevel()` rules, discovered by glob. The reference above lives
// here rather than in tsconfig.json for the reason `src/boot/discover.ts` gives:
// tsconfig.json is a shared file and this is the only other module that needs it.
//
// Why a glob and not an index: two stories must each extend the validator
// (FR-011's key placement, FR-014's secret placement), and an index would put
// their one-line additions on adjacent lines of one file, which is a conflict. A
// glob makes a new rule a new file and nothing else. Pure, and vitest runs it
// because vitest transforms through Vite.

import type { LevelError } from '../level-validate';
import type { ItemSpawn, LockKind, PlayerSpawn } from '../level';

/**
 * The error categories the rules contribute, as an augmentable interface. A rule
 * declares its own category by augmenting this from its own file — the same trick
 * `interaction-diag.ts` uses on 001's `Diagnostics` — so no rule ever widens a
 * union declared in someone else's file.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface -- augmented by rules/*.ts
export interface ExtraRuleCategories {}

export type ExtraErrorCategory = keyof ExtraRuleCategories;

/** Everything a rule may read. Additive only, like `GameContext`. */
export interface LevelRuleContext {
  readonly grid: readonly string[];
  readonly playerSpawn: PlayerSpawn;
  readonly itemSpawns: readonly ItemSpawn[];
  readonly doorLocks: Readonly<Record<string, LockKind>>;
}

export type LevelRule = (context: LevelRuleContext) => LevelError[];

/** What a `rules/*.ts` module exports: one named `rule`. */
export interface LevelRuleModule {
  readonly rule: LevelRule;
}

const modules = import.meta.glob('./rules/*.ts', { eager: true });

/** The module paths discovered, for diagnostics — mirrors `discover.ts`. */
export const discoveredRuleModules: string[] = Object.keys(modules).sort();

const isRuleModule = (value: unknown): value is LevelRuleModule =>
  typeof value === 'object' && value != null && typeof (value as LevelRuleModule).rule === 'function';

/** Sorted by module path, so error order does not depend on glob order. */
export function collectLevelRules(): LevelRule[] {
  const rules: LevelRule[] = [];
  for (const path of discoveredRuleModules) {
    const module = modules[path];
    if (isRuleModule(module)) rules.push(module.rule);
  }
  return rules;
}

/** Every extra rule's errors, in one list for the validator to concatenate. */
export function extraLevelErrors(context: LevelRuleContext): LevelError[] {
  return collectLevelRules().flatMap((rule) => rule(context));
}
