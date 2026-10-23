import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('shared thumbnail reader leaves output policy to its callers', async () => {
  const helperSource = await readFile(new URL('./thumbnail-decompression.js', import.meta.url), 'utf8');
  assert.doesNotMatch(helperSource, /THUMBNAIL_OUTPUT_LIMIT_BYTES|MAX_THUMBNAIL_BYTES/);
  assert.match(helperSource, /readExactStreamLimited\(readable, declaredSize, maxBytes\)/);
});

test('native parser enforces its thumbnail output bound', async () => {
  const rustSource = await readFile(new URL('../../engine/src/parser/mod.rs', import.meta.url), 'utf8');
  assert.match(
    rustSource,
    /pub const MAX_THUMBNAIL_BYTES: usize = 10 \* 1024 \* 1024;/,
  );
  assert.match(
    rustSource,
    /extract_preview\(&mut cfb, MAX_THUMBNAIL_BYTES\)/,
  );
});
