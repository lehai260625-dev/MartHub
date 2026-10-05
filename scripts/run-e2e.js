import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from '../playwright.config.js';
import { e2eDatabaseUrl } from './lib/e2e-database.js';

// Each configured viewport is an independent client population. A fresh API/DB
// lifecycle prevents unrelated projects sharing a loopback auth throttle bucket.
// Keep the real limiter enabled; never clear live counters between test cases.
e2eDatabaseUrl();
const cli = fileURLToPath(
  new URL('../node_modules/@playwright/test/cli.js', import.meta.url),
);
for (const project of config.projects) {
  console.log(`Clean E2E project: ${project.name}`);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'test',
      `--project=${project.name}`,
      '--workers=2',
      '--retries=0',
      `--output=test-results/${project.name}`,
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/${project.name}`,
      },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  'All configured E2E projects passed from separate clean baselines.',
);
