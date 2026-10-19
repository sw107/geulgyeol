"""Synthetic physical-section cache controls. Usage: SCRIPT INLINE_CHECK_BINARY FRESH_OUTPUT."""
from pathlib import Path
from zipfile import ZipFile
import copy
import hashlib
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

binary, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
out.mkdir()
subprocess.run([str(binary), 'seed', str(out / 'seed')], check=True)
hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
local = lambda e: e.tag.split('}')[-1]
encode = lambda root: ET.tostring(root, encoding='utf-8', xml_declaration=True)
with ZipFile(out / 'seed/distinct-sections.hwpx') as z:
    source = {n: z.read(n) for n in z.namelist()}
rows = []


def make(name, *, sections=2, target=0, mirrored=False, restart=False, headers=False,
         first_number=None, prefix_odd=False, latest_odd=False):
    data = dict(source)
    for mi, apply in [(0, 'EVEN'), (1, 'ODD')]:
        root = ET.fromstring(data[f'Contents/masterpage{mi}.xml'])
        root.set('type', apply)
        data[f'Contents/masterpage{mi}.xml'] = encode(root)
    for si in range(sections):
        root = ET.fromstring(source[f'Contents/section{min(si, 1)}.xml'])
        p = root[0]
        for t in p.iter():
            if local(t) == 't' and t.text and t.text.startswith('BODY_'):
                t.text = f'BODY_{si}'
        if si == 2:
            next(e for e in p.iter() if local(e) == 'masterPage').set('idRef', 'masterpage0')
        if mirrored and si > 0:
            page = next(e for e in p.iter() if local(e) == 'pagePr')
            page.set('gutterType', 'LEFT_RIGHT')
            margin = next(e for e in page if local(e) == 'margin')
            margin.set('left', '10000')
            margin.set('right', '6000')
            margin.set('gutter', '800')
        if (restart and si == 1) or (first_number is not None and si == 0):
            run = ET.SubElement(p, f'{{{hp}}}run', {'charPrIDRef': '0'})
            ctrl = ET.SubElement(run, f'{{{hp}}}ctrl')
            ET.SubElement(ctrl, f'{{{hp}}}newNum', {'num': str(first_number if si == 0 else 7), 'numType': 'PAGE'})
        if headers and si == 0:
            template = ET.fromstring(data['Contents/masterpage0.xml'])
            sub = next(e for e in template if local(e) == 'subList')
            for kind in ['header', 'footer']:
                for apply in ['ODD', 'EVEN']:
                    run = ET.SubElement(p, f'{{{hp}}}run', {'charPrIDRef': '0'})
                    ctrl = ET.SubElement(run, f'{{{hp}}}ctrl')
                    node = ET.SubElement(ctrl, f'{{{hp}}}{kind}', {'id': '1', 'applyPageType': apply})
                    child = copy.deepcopy(sub)
                    for t in child.iter():
                        if local(t) == 't':
                            t.text = f'{kind.upper()}_{apply}'
                    node.append(child)
        if (prefix_odd and si == 1) or (latest_odd and si == 0):
            template = ET.fromstring(data['Contents/masterpage0.xml'])
            sub = next(e for e in template if local(e) == 'subList')
            for kind in ['header', 'footer']:
                run = ET.SubElement(p, f'{{{hp}}}run', {'charPrIDRef': '0'})
                ctrl = ET.SubElement(run, f'{{{hp}}}ctrl')
                node = ET.SubElement(ctrl, f'{{{hp}}}{kind}', {'id': '2', 'applyPageType': 'ODD'})
                child = copy.deepcopy(sub)
                for t in child.iter():
                    if local(t) == 't': t.text = f'{kind.upper()}_' + ('PREFIX_ODD' if si == 1 else 'LATEST_ODD')
                node.append(child)
        data[f'Contents/section{si}.xml'] = encode(root)
    for si in range(sections, 2):
        del data[f'Contents/section{si}.xml']
    header = ET.fromstring(data['Contents/header.xml'])
    header.set('secCnt', str(sections))
    data['Contents/header.xml'] = encode(header)
    content = ET.fromstring(data['Contents/content.hpf'])
    manifest = next(e for e in content if local(e) == 'manifest')
    spine = next(e for e in content if local(e) == 'spine')
    for parent in [manifest, spine]:
        for e in list(parent):
            ref = e.get('id', e.get('idref', ''))
            if ref.startswith('section') and int(ref[7:]) >= sections:
                parent.remove(e)
    for si in range(2, sections):
        ET.SubElement(manifest, manifest[0].tag, {'id': f'section{si}', 'href': f'Contents/section{si}.xml', 'media-type': 'application/xml'})
        ET.SubElement(spine, spine[0].tag, {'idref': f'section{si}', 'linear': 'yes'})
    data['Contents/content.hpf'] = encode(content)
    # This synthetic RDF index is optional; do not retain stale section links.
    data.pop('META-INF/container.rdf', None)
    dest = out / (name + '.hwpx')
    with ZipFile(dest, 'x') as z:
        for n, b in data.items():
            z.writestr(n, b)
    rows.append({'case': name, 'path': str(dest), 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
                 'sections': sections, 'target': target, 'restart': restart, 'mirrored': mirrored, 'headers': headers,
                 'numberingOracle': True, 'crossFormatHwp': sections <= 2,
                 # These generated HWPX cases contain a single Even root master.
                 'hwpRejectionExpected': sections <= 2})


make('physical-odd-even')
make('mirrored-following', mirrored=True)
make('restart-following', restart=True)
make('three-physical', sections=3)
make('edit-middle-physical', sections=3, target=1)
make('inherited-header-footer', headers=True)
make('restart-with-following', sections=3, restart=True)
make('single-section-control', sections=1)
file = out / 'seed/distinct-sections.hwp'
rows.append({'case': 'hwp-source-control', 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
             'sections': 2, 'target': 0, 'crossFormatHwp': True})
(out / 'manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
legacy_count = len(rows)
make('middle-prefix-headers', sections=3, target=1, headers=True)
make('even-prefix-headers', sections=3, target=1, headers=True, first_number=2)
make('two-clean-prefixes', sections=4, target=2, headers=True, prefix_odd=True)
make('latest-definition-order', sections=3, target=1, headers=True, latest_odd=True)
(out / 'carry-bases.json').write_text(json.dumps(rows[legacy_count:], indent=2) + '\n')
print(json.dumps({'fixtures': legacy_count, 'carryBases': len(rows)-legacy_count}))
