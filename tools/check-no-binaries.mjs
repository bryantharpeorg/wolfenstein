import fs from 'node:fs/promises';
import path from 'node:path';

export const FORBIDDEN_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'mp3', 'wav', 'ogg',
  'glb', 'gltf', 'fbx',
  'ttf', 'woff',
];

const EXTENSION_PATTERN = new RegExp(
  `\\.(?:${FORBIDDEN_EXTENSIONS.join('|')})$`,
  'i',
);

/**
 * @typedef {{ violations: string[] }} CheckResult
 */

/**
 * Walk the given directory roots and return any files whose extension is on the
 * forbidden list. Node modules, distribution output and hidden directories are
 * skipped because they are not project source.
 *
 * @param {string[]} roots
 * @returns {Promise<CheckResult>}
 */
export async function checkNoBinaries(roots) {
  /** @type {string[]} */
  const violations = [];

  for (const root of roots) {
    try {
      await walk(root, violations);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  return { violations };
}

/**
 * @param {string} dir
 * @param {string[]} violations
 * @returns {Promise<void>}
 */
async function walk(dir, violations) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      await walk(fullPath, violations);
      continue;
    }

    if (EXTENSION_PATTERN.test(entry.name)) {
      violations.push(fullPath);
    }
  }
}

async function main() {
  const roots = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['.'];

  const { violations } = await checkNoBinaries(roots);

  if (violations.length) {
    for (const v of violations) {
      console.error(`Forbidden binary asset: ${v}`);
    }
    process.exit(1);
  }

  console.log('No forbidden binary asset files found.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
