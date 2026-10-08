// Run the shared lifecycle regressions against the actual signed application.
import path from 'node:path';
process.env.GEULGYEOL_QA_PACKAGED_APP=path.resolve(process.argv[3]);
await import('./check-electron-document-lifecycle.mjs');
