#!/usr/bin/env python3
"""Record pinned full-font metadata and license inputs; does not grant RFN clearance."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
from fontTools.ttLib import TTFont

if not __debug__:
    raise SystemExit('Validation requires Python assertions; do not use -O')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inputs', type=Path, required=True)
parser.add_argument('--output-root', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
sha = lambda b: hashlib.sha256(b).hexdigest()
inventory_bytes = (root / 'desktop/web/licenses/FONT_SOURCE_PROVENANCE.json').read_bytes()
inventory = json.loads(inventory_bytes)
input_bytes = args.inputs.read_bytes()
data = json.loads(input_bytes)
assert data['schemaVersion'] == 1 and data['productInventorySHA256'] == sha(inventory_bytes)
assert len(data['fonts']) == 8 and not args.output_root.exists()
assert {r['file'] for r in data['fonts']} == {r['file'] for r in inventory['fonts'] if r['file'].startswith('Nanum')}
args.output_root.mkdir()
rows, licenses = [], {}
for row in data['fonts']:
    pinned = next(x for x in inventory['fonts'] if x['file'] == row['file'])
    assert row['weight'] == pinned['metadataWeight']
    variants = {x['kind']: x for x in row['variants']}
    assert variants['current-woff2']['sha256'] == pinned['sha256']
    assert variants['official-full-ttf']['sha256'] == pinned['glyphReference']['TTF_SHA256']
    for v in variants.values():
        b = Path(v['path']).read_bytes()
        assert 0 < len(b) == v['bytes'] <= 64 * 1024 * 1024 and sha(b) == v['sha256']
    reference = Path(variants['official-full-ttf']['path'])
    license_file = reference.parent / 'OFL.txt'
    license_bytes = license_file.read_bytes()
    license_name = reference.parent.name + '-OFL.txt'
    normalized_license = b' '.join(license_bytes.split())
    assert b'Reserved Font Name' in normalized_license and b'SIL OPEN FONT LICENSE' in normalized_license and b'Version 1.1' in normalized_license
    if license_name not in licenses:
        shutil.copyfile(license_file, args.output_root / license_name)
        packaged_notice = root / 'desktop/web/licenses' / license_name
        licenses[license_name] = {'sha256': sha(license_bytes), 'bytes': len(license_bytes),
            'copyrightAndRFNHeader': license_bytes.decode().split('This Font Software')[0].strip(),
            'currentPackageNoticeByteIdentical': packaged_notice.read_bytes() == license_bytes}
    with TTFont(reference, lazy=True) as original:
        tables = {tag: original.reader[tag] for tag in original.reader.keys()}
        metadata = {str(i): original['name'].getDebugName(i) for i in [0, 1, 2, 3, 4, 5, 6, 13, 14]}
        assert sorted(original.getBestCmap()) == row['sourceCodepoints']
    candidates = []
    for kind in ['official-full-woff2-null', 'official-full-woff2-transformed']:
        v = variants[kind]
        with TTFont(v['path'], lazy=True) as font:
            actual = {tag: font.reader[tag] for tag in font.reader.keys()}
            changed = sorted(tag for tag in tables.keys() | actual.keys() if tables.get(tag) != actual.get(tag))
            allowed = {'head', 'DSIG'} | ({'glyf', 'loca'} if kind.endswith('transformed') else set())
            assert set(changed) <= allowed
            assert actual['name'] == tables['name'] and actual['cmap'] == tables['cmap']
            assert sorted(font.getBestCmap()) == row['sourceCodepoints']
        header = struct.unpack('>4sIIHHIIHHIIIII', Path(v['path']).read_bytes()[:48])
        assert header[0] == b'wOF2' and header[9:12] == (0, 0, 0)
        candidates.append({'kind': kind, 'sha256': v['sha256'], 'bytes': v['bytes'], 'changedDecodedTables': changed,
            'nameTableByteIdentical': True, 'cmapTableByteIdentical': True, 'fullMappingCount': len(row['sourceCodepoints']),
            'layoutTablesByteIdentical': all(tables.get(tag) == actual.get(tag) for tag in ['GDEF', 'GPOS', 'GSUB', 'kern']),
            'WOFF2ExtendedMetadataOmitted': True})
    rows.append({'file': row['file'], 'sourceTTFSHA256': variants['official-full-ttf']['sha256'],
        'sourceTTFBytes': variants['official-full-ttf']['bytes'], 'sourceNameMetadata': metadata,
        'sourceHasDSIG': 'DSIG' in tables, 'license': license_name, 'candidates': candidates})
result = {'sourceSHA256': sha(Path(__file__).read_bytes()), 'inputSHA256': sha(input_bytes),
    'productInventorySHA256': sha(inventory_bytes), 'fonts': rows, 'licenses': licenses,
    'technicalMetadataAuditOnly': True, 'RFNClearanceGranted': False, 'productFontsReplaced': False,
    'releaseHeld': True, 'sources': ['https://openfontlicense.org/open-font-license-official-text/',
        'https://openfontlicense.org/ofl-faq/', 'https://www.w3.org/TR/WOFF2/']}
(args.output_root / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'sourceFonts': len(rows), 'candidateWOFF2': sum(len(x['candidates']) for x in rows),
    'licenses': len(licenses), 'RFNClearanceGranted': False}))
