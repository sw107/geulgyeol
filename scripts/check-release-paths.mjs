import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const sdkFiles = ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts'];

// Report filenames/counts only; never print the private paths being detected.
export function auditSdk(directory, originalPrefixes = []) {
  const findings = [];
  for (const file of sdkFiles) {
    const full = path.join(directory, file), stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SDK entries must be ordinary files: ' + file);
    const bytes = fs.readFileSync(full), text = bytes.toString('utf8');
    const patterns = {
      posixUserPath: /\/(?:Users|home)\/[^/\s"'<>]+/g,
      windowsUserPath: /[A-Za-z]:\\+(?:Users|Documents and Settings)\\+[^\\\s"'<>]+/gi,
    };
    for (const [rule, regex] of Object.entries(patterns)) {
      const count = [...text.matchAll(regex)].length;
      if (count) findings.push({ file, rule, count });
    }
    if (originalPrefixes.some(prefix => bytes.includes(Buffer.from(prefix)))) findings.push({ file, rule: 'originalBuildPrefix', count: 1 });
  }
  return { clean: findings.length === 0, filesChecked: sdkFiles.length, findings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = auditSdk(path.resolve(process.argv[2]));
  console.log(JSON.stringify(result));
  if (!result.clean) process.exitCode = 1;
}
