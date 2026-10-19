// wasm PKG MANIFEST NATIVE_RAW FRESH_OUTPUT | verify NATIVE_RAW WASM_RAW FRESH_PROOF baseline|fixed
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [mode, ...args] = process.argv.slice(2),
  sha = b => createHash('sha256').update(b).digest('hex'),
  walk = n => [n, ...(n.children ?? []).flatMap(walk)];
if (mode === 'wasm') {
  const [pkg, manifest, nativeFile, out] = args;
  fs.mkdirSync(out);
  const M = await import(pathToFileURL(path.resolve(pkg, 'rhwp.js')));
  M.initSync({
    module: fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))
  });
  const fixtures = JSON.parse(fs.readFileSync(manifest)),
    native = JSON.parse(fs.readFileSync(nativeFile)),
    rows = [];
  for (const f of fixtures) {
    const bytes = fs.readFileSync(f.path);
    assert.equal(sha(bytes), f.sha256);
    const d = new M.HwpDocument(bytes);
    const view = (doc, stage) => {
      const template = native.rows.find(r => r.case === f.case && r.stage === stage).result.live;
      assert.equal(doc.pageCount(), template.pages);
      // WASM JSON omits char_start: derive scalar intervals from the entire
      // rendered stream rather than the caret API or note-entry discovery.
      const streams = new Map();
      for (let p = 0; p < doc.pageCount(); p++) {
        const owner = JSON.parse(doc.getPageInfo(p)).sectionIndex;
        for (const r of walk(JSON.parse(doc.getPageRenderTree(p))).filter(r => r.type === 'TextRun')) {
          const key = owner + ':' + r.pi;
          if (!streams.has(key)) streams.set(key, []);
          const list = streams.get(key),
            start = list.reduce((n, r) => n + [...r.text].length, 0);
          list.push({
            ...r,
            page: p,
            owner,
            start,
            end: start + [...r.text].length
          });
        }
      }
      const queries = template.queries.map(q => {
        const e = q.expected,
          list = streams.get(e.owner + ':' + e.para);
        assert(list);
        const target = list.find(r => r.start === q.renderOffset) ?? list.find(r => r.start <= q.renderOffset && q.renderOffset < r.end) ?? list.findLast(r => r.end === q.renderOffset);
        assert(target);
        assert.equal(target.page, e.page);
        for (const [k, i] of [['x', 0], ['y', 1], ['w', 2], ['h', 3]]) assert(Math.abs(target.bbox[k] - e.bbox[i]) <= 0.051, 'independent WASM render target');
        const result = {
          source: q.source,
          offset: q.offset,
          renderOffset: q.renderOffset,
          expected: e
        };
        try {
          result.rect = JSON.parse(doc.getCursorRectInNote(...q.source, q.offset));
          const r = result.rect;
          try {
            result.hit = JSON.parse(doc.hitTest(r.pageIndex, r.x, r.y + r.height * .5));
          } catch (e) {
            result.hitError = String(e);
          }
        } catch (e) {
          result.error = String(e);
        }
        return result;
      });
      return {
        pages: doc.pageCount(),
        queries
      };
    };
    const check = stage => {
      const live = view(d, stage),
        bytes = d.exportHwpx();
      fs.writeFileSync(path.join(out, f.case + '-' + stage + '.hwpx'), bytes, {
        flag: 'wx'
      });
      const cold = new M.HwpDocument(bytes);
      try {
        rows.push({
          case: f.case,
          stage,
          result: {
            live,
            cold: view(cold, stage)
          }
        });
      } finally {
        cold.free();
      }
    };
    try {
      const initial = d.saveSnapshot();
      check('before');
      for (const t of f.actions) d.insertTextInFootnote(t.section, t.para, t.control, t.notePara, 0, t.text);
      const grown = d.saveSnapshot();
      check('grown');
      d.restoreSnapshot(initial);
      check('undo');
      d.restoreSnapshot(grown);
      check('redo');
      d.discardSnapshot(initial);
      d.discardSnapshot(grown);
    } finally {
      d.free();
    }
  }
  fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify({
    GUIVerified: false,
    wasmSHA256: sha(fs.readFileSync(path.join(pkg, 'rhwp_bg.wasm'))),
    rows
  }), {
    flag: 'wx'
  });
  console.log('WASM cursor stages=' + rows.length);
} else if (mode === 'verify') {
  const [nativeFile, wasmFile, proof, expect] = args,
    native = JSON.parse(fs.readFileSync(nativeFile)),
    wasm = JSON.parse(fs.readFileSync(wasmFile)),
    rows = [];
  assert(['baseline', 'fixed'].includes(expect));
  assert(native.rows.length > 0);
  assert.equal(native.rows.length, wasm.rows.length);
  const check = q => {
    const errors = [],
      r = q.rect,
      e = q.expected,
      b = e.bbox;
    if (!r) return ['cursorError'];
    if (r.pageIndex !== e.page) errors.push('page');
    if (Math.abs(r.y - e.caretY) > 0.11) errors.push('lineY');
    if (Math.abs(r.height - e.font) > 0.11) errors.push('height');
    if (r.x < b[0] - .6 || r.x > b[0] + b[2] + .6) errors.push('runX');
    if (e.atRunStart && Math.abs(r.x - b[0]) > .11) errors.push('runStartX');
    // Empty paragraph placeholders span the frame without any glyph advance.
    if (e.atRunEnd && e.end > e.start && Math.abs(r.x - b[0] - b[2]) > .6) errors.push('runEndX');
    const h = q.hit;
    // hitTest exposes render owner/paragraph/scalar addresses. The producer's
    // source map supplies their inverse; UI entry/dispatch remains separate.
    if (!h || h.sectionIndex !== e.owner || h.paragraphIndex !== e.para || h.charOffset !== q.renderOffset || h.cursorRect?.pageIndex !== e.page) errors.push('hitInverse');
    return errors;
  };
  for (const [i, nr] of native.rows.entries()) {
    const wr = wasm.rows[i];
    assert.equal(nr.case, wr.case);
    assert.equal(nr.stage, wr.stage);
    let mismatches = 0;
    const failures = [];
    for (const variant of ['live', 'cold', 'rebuilt']) {
      const view = nr.result[variant];
      assert.equal(view.pages, nr.result.live.pages);
      assert.equal(view.queries.length, nr.result.live.queries.length);
      for (const [j, q] of view.queries.entries()) {
        const errors = check(q);
        if (errors.length) failures.push({
          runtime: 'native',
          variant,
          source: q.source,
          offset: q.offset,
          errors
        });
        if (JSON.stringify(q) !== JSON.stringify(nr.result.live.queries[j])) mismatches++;
      }
    }
    for (const variant of ['live', 'cold']) {
      const view = wr.result[variant];
      assert.equal(view.queries.length, nr.result.live.queries.length);
      for (const [j, q] of view.queries.entries()) {
        assert.deepEqual(q.expected, nr.result.live.queries[j].expected);
        const errors = check(q);
        if (errors.length) failures.push({
          runtime: 'wasm',
          variant,
          source: q.source,
          offset: q.offset,
          errors
        });
        if (JSON.stringify(q) !== JSON.stringify(wr.result.live.queries[j])) mismatches++;
        if (expect !== 'baseline') {
          assert.deepEqual(q.rect, nr.result[variant].queries[j].rect);
          assert.deepEqual(q.hit, nr.result[variant].queries[j].hit);
        }
      }
    }
    rows.push({
      case: nr.case,
      stage: nr.stage,
      pages: nr.result.live.pages,
      queriesPerVariant: nr.result.live.queries.length,
      failures,
      mismatches
    });
  }
  const failures = rows.reduce((n, r) => n + r.failures.length, 0),
    mismatches = rows.reduce((n, r) => n + r.mismatches, 0),
    result = {
      GUIVerified: false,
      wasmSHA256: wasm.wasmSHA256,
      stages: rows.length,
      queriesPerRuntimeLive: rows.reduce((n, r) => n + r.queriesPerVariant, 0),
      nativeQueryChecks: rows.reduce((n, r) => n + r.queriesPerVariant * 3, 0),
      wasmQueryChecks: rows.reduce((n, r) => n + r.queriesPerVariant * 2, 0),
      failures,
      mismatches,
      rows
    };
  fs.writeFileSync(proof, JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx'
  });
  if (expect === 'baseline') assert(failures > 0);else {
    assert.equal(failures, 0);
    assert.equal(mismatches, 0);
  }
  console.log(JSON.stringify({
    ...result,
    rows: undefined
  }));
} else throw Error('unknown mode');
