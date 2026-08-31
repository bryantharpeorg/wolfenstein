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
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
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
