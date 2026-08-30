import fs from 'node:fs/promises';
import { checkNoBinaries } from './check-no-binaries.mjs';

const DIST_INDEX = new URL('../dist/index.html', import.meta.url);

async function main() {
  let hadError = false;

  try {
    await fs.access(DIST_INDEX);
  } catch {
    console.error('Smoke failed: dist/index.html is missing. Run `npm run build` first.');
    hadError = true;
  }

  const { violations } = await checkNoBinaries(['.']);
  if (violations.length) {
    for (const v of violations) {
      console.error(`Forbidden binary asset: ${v}`);
    }
    hadError = true;
  }

  if (hadError) {
    process.exit(1);
  }

  console.log('Smoke passed: dist/index.html exists and no binary assets were found.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
