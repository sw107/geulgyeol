import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const groups = [
  { name: 'Studio', directory: 'rhwp-studio/tests' },
  { name: 'editor host', directory: 'npm/editor/tests' },
];

try {
  for (const group of groups) {
    const directory = path.join(root, group.directory);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    group.files = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
      .map(entry => path.join(directory, entry.name))
      .sort();
  }

  const missing = groups.filter(group => group.files.length === 0);
  if (missing.length > 0) {
    throw new Error('No .test.mjs files found for required test group(s): '
      + missing.map(group => `${group.name} (${group.directory})`).join(', '));
  }

  console.log(groups.map(group => `${group.name}: ${group.files.length} test file(s)`).join('; '));
  const result = spawnSync(process.execPath, [
    '--test', ...process.argv.slice(2), ...groups.flatMap(group => group.files),
  ], { cwd: path.join(root, 'rhwp-studio'), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Test process terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
