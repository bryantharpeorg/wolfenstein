#!/usr/bin/env node
/**
 * Validate every spec against Ergane's Work Graph deriver and the Spec Kit grammar
 * Ergane's criteria parser expects. Run after editing any spec.md.
 *
 *   node tools/validate-specs.mjs
 *
 * The deriver rejects an entire graph for one malformed declaration, so a typo in a
 * `implements:` list strands a whole epic at dispatch time. Catching that here costs
 * a second; catching it mid-epic costs a dispatched node.
 *
 * Requires the ergane checkout (for factory.workgraph.derive) and its venv. Override
 * with ERGANE_ROOT.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ERGANE = process.env.ERGANE_ROOT ?? resolve(ROOT, "../ergane");
const PY = join(ERGANE, ".venv/bin/python");

if (!existsSync(PY)) {
  console.error(`ergane venv not found at ${PY}\nSet ERGANE_ROOT to the ergane checkout.`);
  process.exit(2);
}

const specs = readdirSync(join(ROOT, "specs"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{3}-/.test(d.name))
  .map((d) => d.name)
  .sort();

if (specs.length === 0) {
  console.error("no specs found under specs/");
  process.exit(2);
}

let failed = 0;

for (const name of specs) {
  const specPath = join(ROOT, "specs", name, "spec.md");
  if (!existsSync(specPath)) {
    console.log(`FAIL  ${name}  — no spec.md`);
    failed++;
    continue;
  }

  try {
    const out = execFileSync(
      PY,
      [
        "-c",
        `
import sys, json
sys.path.insert(0, ${JSON.stringify(ERGANE)})
from factory.workgraph.derive import derive_workgraph
text = open(${JSON.stringify(specPath)}).read()
g = derive_workgraph(text, epic_id=${JSON.stringify(name)}, feature=${JSON.stringify(name)}, specs_root="specs", target_repo=${JSON.stringify(ROOT)})
print(json.dumps({"n": len(g.nodes), "edges": {x.id: x.depends_on for x in g.nodes}, "keys": {x.id: x.requirement_keys for x in g.nodes}}))
`,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(out.trim().split("\n").at(-1));

    // requirement_keys must cover every FR the spec defines, with no dangling refs.
    const src = readFileSync(specPath, "utf8");
    const declared = [...src.matchAll(/^- \*\*(FR-\d+)\*\*:/gm)].map((m) => m[1]);
    const implemented = Object.values(parsed.keys).flat().filter((k) => k.startsWith("FR-"));
    const missing = declared.filter((f) => !implemented.includes(f));
    const dangling = implemented.filter((f) => !declared.includes(f));

    if (missing.length || dangling.length) {
      console.log(`FAIL  ${name}  — ${parsed.n} nodes derive, but:`);
      if (missing.length) console.log(`        FRs defined yet implemented by no story: ${missing.join(", ")}`);
      if (dangling.length) console.log(`        FRs implemented but never defined:     ${dangling.join(", ")}`);
      failed++;
      continue;
    }

    const dupes = implemented.filter((f, i) => implemented.indexOf(f) !== i);
    if (dupes.length) {
      console.log(`WARN  ${name}  — FR implemented by more than one story: ${[...new Set(dupes)].join(", ")}`);
    }

    console.log(`ok    ${name}  — ${parsed.n} node(s), ${declared.length} FRs, all covered`);
  } catch (err) {
    const detail = (err.stderr || err.message || String(err)).toString().trim();
    console.log(`FAIL  ${name}\n${detail.split("\n").map((l) => "        " + l).join("\n")}`);
    failed++;
  }
}

console.log(
  failed === 0
    ? `\nAll ${specs.length} specs derive cleanly.`
    : `\n${failed} of ${specs.length} specs rejected.`,
);
process.exit(failed === 0 ? 0 : 1);
