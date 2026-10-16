#!/usr/bin/env python3
"""Prepare QA-only font alternatives from pinned, already downloaded references.

Requires fontTools/Brotli. Does not download, install, or replace product fonts.
The output directory must not exist; all input hashes are checked before writing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import unicodedata

from fontTools.ttLib import TTFont, woff2


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_head(data):
    value = bytearray(data)
    value[8:12] = bytes(4)
    value[16:18] = (int.from_bytes(value[16:18], 'big') | 0x800).to_bytes(2, 'big')
    return value


def verify_conversion(source, target, transformed):
    a, b = TTFont(source), TTFont(target)
    try:
        removed = set(a.reader.keys()) - set(b.reader.keys())
        added = set(b.reader.keys()) - set(a.reader.keys())
        assert removed <= {'DSIG'} and not added
        allowed = {'head', 'DSIG'} | ({'glyf', 'loca'} if transformed else set())
        assert all(a.reader[tag] == b.reader[tag] for tag in set(a.reader.keys()) - allowed)
        assert normalized_head(a.reader['head']) == normalized_head(b.reader['head'])
        assert a.getBestCmap() == b.getBestCmap()
        return {'removedTables': sorted(removed), 'preprocessingTransforms': ['glyf', 'loca'] if transformed else [],
                'allOtherTableBytesIdentical': True, 'headOnlyChecksumAndWoff2Flag': True}
    finally:
        a.close()
        b.close()


def main():
    if not __debug__:
        raise RuntimeError('Run without -O/PYTHONOPTIMIZE: integrity assertions must remain enabled')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    inventory_path = root / 'desktop/web/licenses/FONT_SOURCE_PROVENANCE.json'
    inventory = json.loads(inventory_path.read_text())
    rows = [x for x in inventory['fonts'] if x['file'].startswith('Nanum')]
    assert len(rows) == 8
    output = args.output_root.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing to overwrite an existing output directory')
    inputs = []
    for row in rows:
        name = row['file']
        assert Path(name).name == name and name.endswith('.woff2')
        current = root / 'assets/fonts' / name
        reference = args.reference_root.resolve() / name.split('-')[0].lower() / (Path(name).stem + '.ttf')
        assert sha(current) == row['sha256'], 'Current product font disagrees with inventory: ' + name
        assert sha(reference) == row['glyphReference']['TTF_SHA256'], 'Wrong official reference: ' + name
        inputs.append((row, current, reference))
    output.mkdir()
    prepared = []
    for row, current, reference in inputs:
        name = row['file']
        current_ttf = output / (Path(name).stem + '-current.ttf')
        font = TTFont(current, recalcBBoxes=False, recalcTimestamp=False)
        current_cmap = font.getBestCmap()
        font.close()
        # Decode from a fresh lazy reader: querying cmap above loads tables that
        # TTFont.save may reserialize, which would weaken this format control.
        woff2.decompress(current, current_ttf)
        controls = verify_conversion(current, current_ttf, False)
        variants = [{'kind': 'current-woff2', 'path': str(current), 'sha256': sha(current), 'bytes': current.stat().st_size},
                    {'kind': 'current-sfnt-control', 'path': str(current_ttf), 'sha256': sha(current_ttf), 'bytes': current_ttf.stat().st_size, 'tableCheck': controls},
                    {'kind': 'official-full-ttf', 'path': str(reference), 'sha256': sha(reference), 'bytes': reference.stat().st_size}]
        for transformed in [False, True]:
            kind = 'official-full-woff2-transformed' if transformed else 'official-full-woff2-null'
            target = output / (Path(name).stem + '-' + kind + '.woff2')
            woff2.compress(reference, target, transform_tables=None if transformed else [])
            table_check = verify_conversion(reference, target, transformed)
            variants.append({'kind': kind, 'path': str(target), 'sha256': sha(target), 'bytes': target.stat().st_size,
                             'tableCheck': table_check})
        source_font = TTFont(reference)
        source_cmap = source_font.getBestCmap()
        source_font.close()
        assert set(current_cmap) <= set(source_cmap)
        added = sorted(set(source_cmap) - set(current_cmap))
        visible_added = [cp for cp in added if unicodedata.category(chr(cp))[0] not in 'CMZ' and not 0xD800 <= cp <= 0xDFFF]
        prepared.append({'file': name, 'weight': row['metadataWeight'], 'variants': variants,
                         'currentCodepoints': sorted(current_cmap), 'sourceCodepoints': sorted(source_cmap),
                         'sourceAddedCodepoints': added, 'coverageSample': visible_added[:8] + visible_added[-8:],
                         'referenceURL': row['glyphReference']['TTF_URL']})
    result = {'schemaVersion': 1, 'productInventorySHA256': sha(inventory_path), 'fonts': prepared,
              'productFontsReplaced': False, 'nativeUIVerified': False, 'releaseHeld': True}
    (output / 'inputs.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'fontFiles': len(prepared), 'inputManifest': str(output / 'inputs.json'),
                      'currentMappings': sum(len(x['currentCodepoints']) for x in prepared),
                      'sourceMappings': sum(len(x['sourceCodepoints']) for x in prepared),
                      'sourceAddedMappings': sum(len(x['sourceAddedCodepoints']) for x in prepared)}), flush=True)


if __name__ == '__main__':
    main()
