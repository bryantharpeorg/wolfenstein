import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { walkAndReport } from './check-no-binaries.mjs';

const root = resolve(import.meta.dirname, '..');

function main() {
  const findings = walkAndReport(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    process.exit(1);
  }

  const indexHtml = resolve(root, 'dist', 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(`missing:${indexHtml}`);
    process.exit(1);
  }

  console.log('Smoke checks passed: no binary assets, dist/index.html present.');
}

main();
