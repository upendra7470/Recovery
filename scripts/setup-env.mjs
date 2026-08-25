import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [
  { example: '.env.example', destination: join('apps', 'api', '.env') },
  { example: '.env.example', destination: join('apps', 'web', '.env.local') },
];

for (const { example, destination } of targets) {
  const targetPath = join(root, destination);
  if (existsSync(targetPath)) {
    console.log(`skip  ${destination} (already exists)`);
    continue;
  }
  copyFileSync(join(root, example), targetPath);
  console.log(`created  ${destination}`);
}

console.log('\nDone. Review the generated files and adjust values if needed.');
