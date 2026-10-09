// Run the final-close acknowledgment races against the actual signed app.
import path from 'node:path';
process.env.GEULGYEOL_QA_PACKAGED_APP=path.resolve(process.argv[3]);
process.argv.splice(3,1); // Shared suite reads its scenario at argv[3].
await import('./check-electron-final-ack.mjs');
