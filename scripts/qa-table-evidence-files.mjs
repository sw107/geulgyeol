// Immutable QA artifacts. Mutable app control messages use their separate writer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const safeName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
export function operationEvidencePrefix(fixture, operation) {
 assert(safeName(fixture) && safeName(operation), 'safe fixture and operation names required');
 return fixture + '-' + operation;
}
export function writeImmutableEvidence(directory, name, data) {
 assert(safeName(name), 'safe immutable evidence basename required');
 fs.writeFileSync(path.join(directory, name), data, {flag: 'wx'});
}
