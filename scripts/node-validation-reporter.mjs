import {realpathSync} from 'node:fs';
import path from 'node:path';
// Separate reporter: does not discover tests or change their execution/exit code.
// Per-file summaries exclude Node's synthetic "test file passed/failed" records.
export default async function* nodeValidationReporter(events) {
  const files = new Map();
  let summary = null;
  let invalid = false;
  for await (const {type, data} of events) {
    if (!['test:pass', 'test:fail', 'test:summary'].includes(type)) continue;
    if (!data.file) {
      if (type === 'test:summary') {
        if (summary) invalid = true;
        summary = {success: data.success, counts: data.counts};
      }
      continue;
    }
    let filePath = data.file;
    try { filePath = realpathSync(filePath); } catch { /* Preserve missing paths as reported. */ }
    let file = files.get(filePath);
    if (!file) {
      file = {file: filePath, summary: null, errors: [], entryPoint: false};
      files.set(filePath, file);
    }
    if (type !== 'test:summary' && data.nesting === 0 && typeof data.name === 'string') {
      let namePath = path.resolve(data.name);
      try { namePath = realpathSync(namePath); } catch { /* Not a file-level result. */ }
      file.entryPoint ||= namePath === filePath;
    }
    if (type === 'test:summary') {
      if (file.summary) invalid = true;
      file.summary = {success: data.success, counts: data.counts};
    } else if (type === 'test:fail') {
      const error = data.details?.error;
      file.errors.push({name: data.name, failureType: error?.failureType,
        message: error?.message, exitCode: error?.exitCode, signal: error?.signal});
    }
  }
  yield JSON.stringify({version: 1, kind: 'node-test', complete: Boolean(summary) && !invalid,
    summary,
    // Imported helpers can register tests, but only entry-file summaries are counted.
    sourceErrors: [...files.values()].filter(f => !f.summary && !f.entryPoint && f.errors.length)
      .map(f => ({file: f.file, errors: f.errors})),
    files: [...files.values()].filter(f => f.summary || f.entryPoint)
      .map(({entryPoint, ...file}) => file)}, null, 2) + '\n';
}
