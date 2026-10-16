#!/usr/bin/env python3
"""Compare every decoded glyph and remaining table of pinned full-source WOFF2s.

Data-level evidence only: does not grant RFN clearance or replace product fonts.
"""
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import fontTools
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import _g_l_y_f

if not __debug__:
    raise SystemExit('Validation requires assertions; do not use -O')

FULL_KINDS = ('official-full-woff2-null', 'official-full-woff2-transformed')
sha = lambda value: hashlib.sha256(value).hexdigest()
encoded = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def glyph_record(glyph):
    """FontTools retains on-curve/overlap/cubic and semantic component flags.

    Coordinate packing/repeat bits are decoded by the pinned glyf reader. Point
    attachments are recorded directly; getComponentInfo would omit them.
    """
    record = {'contours': glyph.numberOfContours,
              'bbox': [getattr(glyph, key, 0) for key in ('xMin', 'yMin', 'xMax', 'yMax')],
              'programPresent': hasattr(glyph, 'program'),
              'instructions': bytes(glyph.program.getBytecode()).hex() if hasattr(glyph, 'program') else ''}
    if glyph.numberOfContours > 0:
        record.update(coordinates=[list(point) for point in glyph.coordinates],
                      contourEnds=list(glyph.endPtsOfContours), flags=list(glyph.flags))
    elif glyph.numberOfContours < 0:
        components = []
        for component in glyph.components:
            assert set(vars(component)) <= {'glyphName', 'flags', 'x', 'y', 'firstPt', 'secondPt', 'transform'}, 'Unknown component data'
            placement = {'xy': [component.x, component.y]} if hasattr(component, 'x') else {'points': [component.firstPt, component.secondPt]}
            components.append({'glyph': component.glyphName, 'flags': component.flags, 'placement': placement,
                               'transform': [[float(x) for x in row] for row in getattr(component, 'transform', [[1, 0], [0, 1]])]})
        record['components'] = components
    return record


def snapshot_font(data):
    with TTFont(io.BytesIO(data), lazy=True, recalcTimestamp=False) as font:
        assert {'head', 'maxp', 'glyf', 'loca', 'hmtx', 'cmap'} <= set(font.reader.keys())
        assert 'fvar' not in font.reader, 'Only static TrueType references are in scope'
        tables = {tag: font.reader[tag] for tag in font.reader.keys()}
        order = font.getGlyphOrder()
        assert len(order) == font['maxp'].numGlyphs and len(order) > 1 and order[0] == '.notdef'
        unicode_names = set()
        for table in font['cmap'].tables:
            assert table.format != 14, 'Variation-sequence mapping requires a separate classification'
            if table.isUnicode():
                unicode_names.update(table.cmap.values())
        entries = []
        for gid, name in enumerate(order):
            record = glyph_record(font['glyf'][name])
            record['hmtx'] = list(font['hmtx'][name])
            record['vmtx'] = list(font['vmtx'][name]) if 'vmtx' in font else None
            entries.append({'gid': gid, 'name': name, 'unicodeMapped': name in unicode_names,
                            'sha256': sha(encoded(record)), 'contours': record['contours'],
                            'points': len(record.get('coordinates', [])), 'components': len(record.get('components', [])),
                            'instructionBytes': len(record['instructions']) // 2})
        transformed = sorted(tag for tag, entry in font.reader.tables.items() if getattr(entry, 'transformed', False))
        return {'tables': tables, 'order': order, 'glyphs': entries, 'cmap': sorted(font.getBestCmap()),
                'transformedTables': transformed, 'glyphDigest': sha(encoded(entries)),
                'stats': {'glyphs': len(entries), 'unicodeMappedGlyphs': sum(x['unicodeMapped'] for x in entries),
                          'unmappedGlyphs': sum(not x['unicodeMapped'] for x in entries),
                          'simpleGlyphs': sum(x['contours'] > 0 for x in entries),
                          'compositeGlyphs': sum(x['contours'] < 0 for x in entries),
                          'emptyGlyphs': sum(x['contours'] == 0 for x in entries),
                          'glyphsWithInstructions': sum(x['instructionBytes'] > 0 for x in entries),
                          'instructionBytes': sum(x['instructionBytes'] for x in entries)}}


def compare_snapshots(reference, candidate, kind, candidate_bytes):
    assert kind in FULL_KINDS and candidate_bytes[:4] == b'wOF2'
    header = struct.unpack('>4sIIHHIIHHIIIII', candidate_bytes[:48])
    assert header[9:14] == (0, 0, 0, 0, 0), 'Extended/private metadata must be absent in these candidates'
    assert candidate['transformedTables'] == ([] if kind == FULL_KINDS[0] else ['glyf', 'loca']), 'Wrong declared WOFF2 transform profile'
    expected, actual = reference['tables'], candidate['tables']
    assert set(actual) == set(expected) - {'DSIG'}, 'Unexpected table addition/removal'
    changed = sorted(tag for tag in actual if actual[tag] != expected[tag])
    allowed = {'head'} | ({'glyf', 'loca'} if kind == FULL_KINDS[1] else set())
    assert set(changed) <= allowed, 'Non-compression table difference: ' + str(changed)
    ref_head, actual_head = bytearray(expected['head']), bytearray(actual['head'])
    ref_flags = int.from_bytes(ref_head[16:18], 'big')
    assert int.from_bytes(actual_head[16:18], 'big') == ref_flags | 0x0800, 'Unexpected head flag change'
    ref_head[8:12] = actual_head[8:12] = b'\0' * 4
    ref_head[16:18] = actual_head[16:18] = b'\0' * 2
    assert ref_head == actual_head, 'Other head bytes changed'
    assert reference['order'] == candidate['order'], 'Glyph order changed'
    assert reference['cmap'] == candidate['cmap'], 'Character mapping changed'
    assert len(reference['glyphs']) == len(candidate['glyphs'])
    differences = [a['gid'] for a, b in zip(reference['glyphs'], candidate['glyphs']) if a != b]
    assert not differences, 'Decoded glyph/metric/instruction difference at IDs ' + str(differences[:20])
    assert reference['glyphDigest'] == candidate['glyphDigest']
    return {'kind': kind, 'glyphsCompared': len(candidate['glyphs']), 'unmappedGlyphsCompared': candidate['stats']['unmappedGlyphs'],
            'notdefCompared': candidate['glyphs'][0]['name'] == '.notdef', 'canonicalGlyphDigest': candidate['glyphDigest'],
            'sourceDSIGRemoved': 'DSIG' in expected, 'changedDecodedTables': changed,
            'headDifferencesLimitedToChecksumAndBit11': True, 'allOtherTablesByteIdentical': True, 'glyphDifferences': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output_root.exists(), 'Fresh output directory required'
    assert fontTools.__version__ == '4.61.1', 'Use the pinned FontTools 4.61.1 decoder'
    root = Path(__file__).resolve().parent.parent
    input_bytes = args.inputs.read_bytes()
    # Reuse the reviewed exact 8×5 input/baseline contract rather than duplicate it.
    node = """import fs from 'node:fs';import crypto from 'node:crypto';import{pathToFileURL}from'node:url';
const root=process.argv[1],file=process.argv[2];const m=await import(pathToFileURL(root+'/scripts/lib/electron-font-runtime-contract.mjs'));
const b=fs.readFileSync(file);const buffers=m.validateFontInputs(JSON.parse(b),fs.readFileSync(root+'/desktop/web/licenses/FONT_SOURCE_PROVENANCE.json'));
console.log(JSON.stringify({profiles:buffers.size,inputSHA256:crypto.createHash('sha256').update(b).digest('hex')}));"""
    checked = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', node, str(root), str(args.inputs.resolve())]))
    assert checked['profiles'] == 40 and checked['inputSHA256'] == sha(input_bytes)
    data, buffers = json.loads(input_bytes), {}
    for row in data['fonts']:
        for v in row['variants'][2:]:
            value = Path(v['path']).read_bytes()
            assert len(value) == v['bytes'] and sha(value) == v['sha256']
            buffers[(row['file'], v['kind'])] = value
    assert len(buffers) == 24
    args.output_root.mkdir()
    rows = []
    for row in data['fonts']:
        reference = snapshot_font(buffers[(row['file'], 'official-full-ttf')])
        assert reference['cmap'] == row['sourceCodepoints']
        comparisons = []
        for kind in FULL_KINDS:
            payload = buffers[(row['file'], kind)]
            result = compare_snapshots(reference, snapshot_font(payload), kind, payload)
            comparisons.append({**result, 'candidateSHA256': sha(payload)})
        glyph_file = row['file'] + '-all-glyph-digests.json'
        (args.output_root / glyph_file).write_bytes(encoded(reference['glyphs']) + b'\n')
        rows.append({'file': row['file'], 'sourceTTFSHA256': sha(buffers[(row['file'], 'official-full-ttf')]),
                     'stats': reference['stats'], 'allGlyphDigestFile': glyph_file, 'allGlyphDigestFileSHA256': sha((args.output_root / glyph_file).read_bytes()),
                     'comparisons': comparisons})
        print(row['file'] + ': all ' + str(reference['stats']['glyphs']) + ' glyphs compared in both full WOFF2s', flush=True)
    assert len(rows) == 8 and len({row['file'] for row in rows}) == 8
    assert sum(len(row['comparisons']) for row in rows) == 16
    assert all(x['glyphsCompared'] == row['stats']['glyphs'] and x['notdefCompared'] for row in rows for x in row['comparisons'])
    proof = {'sourceSHA256': sha(Path(__file__).read_bytes()), 'inputContractSHA256': sha((root / 'scripts/lib/electron-font-runtime-contract.mjs').read_bytes()),
             'inputSHA256': sha(input_bytes), 'fontTools': fontTools.__version__, 'python': sys.version,
             'glyfDecoderSHA256': sha(Path(_g_l_y_f.__file__).read_bytes()), 'rows': rows,
             'sourceFonts': len(rows), 'candidateComparisons': 16,
             'sourceGlyphs': sum(row['stats']['glyphs'] for row in rows),
             'glyphComparisons': sum(x['glyphsCompared'] for row in rows for x in row['comparisons']),
             'unmappedGlyphComparisons': sum(x['unmappedGlyphsCompared'] for row in rows for x in row['comparisons']),
             'allGlyphDataEqual': True, 'nativeAllGlyphRenderingVerified': False, 'RFNClearanceGranted': False,
             'productFontsReplaced': False, 'releaseHeld': True}
    (args.output_root / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({key: proof[key] for key in ['sourceFonts', 'candidateComparisons', 'sourceGlyphs', 'glyphComparisons', 'unmappedGlyphComparisons', 'RFNClearanceGranted']}))


if __name__ == '__main__':
    main()
