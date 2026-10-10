#!/usr/bin/env python3
"""Check existing Native ledgers without duplicating their SVG or source files.

Usage: check-three-column-owner-native-evidence.py SEEDS_JSON LEDGER_ROOT FRESH_PROOF
Generate ledgers with three_column_owner_check and both mixed-owner diagnostics.
This reads immutable evidence; it does not load the editor or change fixtures.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_ownership(document):
    normalize = lambda value: ''.join(value.split())
    owners, pages = document['owners'], document['pages']
    headers = {owner['cell'] for owner in owners if owner['header'] and owner['rowStart'] == 0}
    assert len(headers) == 3
    for owner in owners:
        paragraphs = {i: [] for i in range(len(owner['paragraphs']))}
        for page in pages:
            runs = [run for run in page['text']['runs'] if run.get('cellPath')
                    and run.get('cellIdx') == owner['cell']
                    and run.get('controlIdx') == document['target']['control']
                    and run.get('parentParaIdx') == document['target']['para']]
            runs.sort(key=lambda run: (run['cellParaIdx'], run['charStart']))
            for i, expected in enumerate(owner['paragraphs']):
                text = ''.join(run['text'] for run in runs if run['cellParaIdx'] == i)
                if owner['cell'] in headers:
                    if runs:
                        assert normalize(text) == normalize(expected), ('header', owner['cell'], page['page'])
                else:
                    paragraphs[i].append(text)
        if owner['cell'] not in headers:
            for i, expected in enumerate(owner['paragraphs']):
                assert normalize(''.join(paragraphs[i])) == normalize(expected), ('source-order', owner['cell'], i)
    return headers


def main():
    seeds_path, root, output = map(Path, sys.argv[1:4])
    assert not output.exists(), 'fresh proof required'
    rows = []
    for seed in json.loads(seeds_path.read_text()):
        tracks = seed['trackWidthsHU']
        assert len(tracks) == 3 and all(width > 0 for width in tracks)
        for extension, source in seed['files'].items():
            stem = seed['label'] + '-' + extension
            ledger, log = root / stem / 'ledger.json', root / (stem + '.log')
            document = json.loads(ledger.read_text())
            assert document['cols'] == 3 and document['storedTableWidthHU'] == sum(tracks)
            owners = document['owners']
            assert all(owner['colEnd'] == owner['colStart'] + 1
                       and owner['storedWidthHU'] == tracks[owner['colStart']] for owner in owners)
            for row in range(document['rows']):
                for col in range(3):
                    assert sum(owner['colStart'] == col and owner['rowStart'] <= row < owner['rowEnd']
                               for owner in owners) == 1, ('exact-cover', row, col)
            headers = check_ownership(document)
            table_pages, host_pages, width_errors, clip_errors = [], [], [], []
            for page in document['pages']:
                runs = page['text']['runs']
                tables = [table for table in page['controls']['controls'] if table['type'] == 'table'
                          and table['paraIdx'] == document['target']['para']
                          and table['controlIdx'] == document['target']['control']]
                if tables:
                    table_pages.append(page['page'])
                    assert any(run.get('cellPath') and run['cellIdx'] not in headers for run in runs)
                    assert {run['cellIdx'] for run in runs if run.get('cellPath') and run['cellIdx'] in headers} == headers
                for table in tables:
                    assert abs(table['w'] - sum(tracks) / 75) < .051
                    for cell in table['cells']:
                        # Continuation controls enumerate fragment-local cellIdx;
                        # the stable column coordinate identifies the stored track.
                        error = abs(cell['w'] - tracks[cell['col']] / 75)
                        assert error < .051, (stem, cell['row'], cell['col'], error)
                        width_errors.append(error)
                if tables:
                    svg = ET.fromstring((ledger.parent / ('page-' + str(page['page']) + '.svg')).read_text())
                    for clip in svg.findall('.//{http://www.w3.org/2000/svg}clipPath'):
                        if not clip.attrib.get('id', '').startswith('cell-clip-'):
                            continue
                        rect = clip.find('{http://www.w3.org/2000/svg}rect')
                        if rect is None:
                            continue
                        x, width = float(rect.attrib['x']), float(rect.attrib['width'])
                        candidates = [col for col in range(3)
                                      if abs(x - (tables[0]['x'] + sum(tracks[:col]) / 75)) < .051]
                        assert len(candidates) == 1, ('svg-column-origin', stem, x)
                        error = abs(width - tracks[candidates[0]] / 75)
                        assert error < 1e-8, ('svg-clip-width', stem, width)
                        clip_errors.append(error)
                host_pages.extend(page['page'] for run in runs if not run.get('cellPath')
                                  and run['paraIdx'] >= document['target']['para'])
            assert table_pages and host_pages and min(host_pages) >= table_pages[-1]
            text = log.read_text()
            assert 'LAYOUT_OVERFLOW' not in text
            cuts, previous = [], None
            for match in re.finditer(r'MIXED_OWNER_CUT block=(\d+)\.\.(\d+) start=(\[[^\]]*\]) end=(\[[^\]]*\]) height=([\d.]+) budget=([\d.]+)', text):
                lo, hi, begin, end, height, budget = match.groups()
                begin, end = json.loads(begin), json.loads(end)
                assert 4 <= int(hi) - int(lo) <= 64
                assert previous is None or begin == previous
                assert len(end) == len(begin or end)
                assert all(b >= a for a, b in zip(begin or [0] * len(end), end))
                assert float(height) <= float(budget) + .1
                previous = end
                cuts.append({'begin': begin, 'end': end, 'height': float(height), 'budget': float(budget)})
            if len(table_pages) > 1:
                assert cuts, 'multipart owner cut evidence required'
            result = {'label': seed['label'], 'format': extension, 'sourceSHA256': sha(source),
                      'ledgerSHA256': sha(ledger), 'cutLogSHA256': sha(log), 'sourceOwnershipIssues': 0,
                      'tablePages': table_pages, 'emptyHeaderOnlyFragments': 0, 'repeatedHeaderCells': 3,
                      'paintWidthChecks': len(width_errors), 'maximumRoundedPaintWidthErrorPx': max(width_errors),
                      'fullPrecisionSVGClipWidthChecks': len(clip_errors),
                      'maximumSVGClipWidthErrorPx': max(clip_errors, default=0),
                      'cutCount': len(cuts), 'cutContinuityExact': True, 'warnings': 0}
            if 'boundary' in seed:
                edges = [(float(a), float(b)) for a, b in re.findall(r'residual=([\d.]+) budget=([\d.]+)', text)
                         if abs(float(a) - float(b)) < .2]
                assert len(edges) == 1
                difference = edges[0][0] - edges[0][1]
                assert abs(difference - seed['boundary']['expectedResidualMinusBudgetPx']) < 1e-8
                assert len(table_pages) == seed['expectedTablePages']
                result['boundaryResidualMinusBudgetPx'] = difference
            rows.append(result)
    output.write_text(json.dumps({'cases': len(rows), 'seedIndexSHA256': sha(seeds_path), 'rows': rows}, indent=2) + '\n')
    print(json.dumps({'cases': len(rows), 'paintWidthChecks': sum(row['paintWidthChecks'] for row in rows),
                      'maximumRoundedWidthErrorPx': max(row['maximumRoundedPaintWidthErrorPx'] for row in rows),
                      'ownershipIssues': 0, 'warnings': 0}))


if __name__ == '__main__':
    main()
