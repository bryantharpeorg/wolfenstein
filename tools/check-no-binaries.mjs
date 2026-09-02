import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const FORBIDDEN = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a', // 008 FR-009 names four audio extensions; this one the list omitted (T035)
  '.glb',
  '.gltf',
  '.fbx',
  '.ttf',
  '.woff',
]);

/** Directories whose contents are build output or version-control internals rather than
 *  source, and are therefore not subject to Constitution II. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'playtest', '.playtest-staging']);

/**
 * Recursively walks `root` and returns an array of violation messages for any
 * file whose extension is in the forbidden list.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function walkAndReport(root) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current == null) continue;

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err) {
      // If we cannot read a directory, surface it as a violation so it does not pass
      // silently.
      findings.push(`cannot-read:${current}`);
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        // Build output, not source. `playtest/` holds the video `npm run play` records
        // (009 FR-005): it is gitignored like `dist/` and skipped here for the same reason,
        // and the forbidden list below is deliberately NOT extended with video extensions —
        // that would fail the smoke gate on the playtest runner's own output.
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        queue.push(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (FORBIDDEN.has(extname(entry.name).toLowerCase())) {
          findings.push(`binary-asset:${full}`);
        }
      }
    }
  }

  return findings;
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  const findings = walkAndReport(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    process.exit(1);
  }
  console.log('No binary asset files found.');
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
