"""BINARY FRESH_OUTPUT [EXACT_REVIEW_SEED]; all files are synthetic copies."""
from pathlib import Path
from zipfile import ZipFile
import copy, hashlib, json, subprocess, sys, xml.etree.ElementTree as ET

binary, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
out.mkdir()
subprocess.run([str(binary), 'seed', str(out / 'seed')], check=True)
hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
local = lambda e: e.tag.split('}')[-1]
encode = lambda e: ET.tostring(e, encoding='utf-8', xml_declaration=True)
rows = []


def load(file):
    with ZipFile(file) as z: return {n: z.read(n) for n in z.namelist()}


def make(label, count=2, owner=0, multi=False, same_source=False, placement=None,
         footnote=False, structural=False):
    data = load(out / 'seed' / f'seed-{max(count, 2)}.hwpx')
    roots = [ET.fromstring(data[f'Contents/section{i}.xml']) for i in range(max(count, 2))]
    source_run = next(r for r in roots[0][0] if any(local(e) == 'ctrl' and any(local(c) == 'endNote' for c in e) for e in r))
    source_ctrl = next(e for e in source_run if local(e) == 'ctrl' and any(local(c) == 'endNote' for c in e))
    note_ctrl = copy.deepcopy(source_ctrl)
    if owner != 0:
        source_run.remove(source_ctrl)
        run = ET.SubElement(roots[owner][0], f'{{{hp}}}run', {'charPrIDRef': '0'})
        run.append(copy.deepcopy(note_ctrl))
    if multi or same_source:
        donor = 0 if same_source else 1
        cloned = copy.deepcopy(note_ctrl)
        note = next(e for e in cloned if local(e) == 'endNote')
        note.set('number', '2')
        for e in note.iter():
            if local(e) == 'autoNum': e.set('num', '2')
            if local(e) == 't' and e.text: e.text += '_B'
        run = ET.SubElement(roots[donor][0], f'{{{hp}}}run', {'charPrIDRef': '0'})
        run.append(cloned)
    if placement:
        sd = next(e for e in roots[owner][0].iter() if local(e) == 'secPr')
        shape = next(e for e in sd if local(e) == 'endNotePr')
        next(e for e in shape if local(e) == 'placement').set('place', placement)
    if footnote:
        note = next(e for e in roots[owner][0].iter() if local(e) == 'endNote')
        note.tag = f'{{{hp}}}footNote'
        for e in note.iter():
            if local(e) == 'autoNum': e.set('numType', 'FOOTNOTE')
    for i in range(count): data[f'Contents/section{i}.xml'] = encode(roots[i])
    for i in range(count, max(count, 2)): del data[f'Contents/section{i}.xml']
    h = ET.fromstring(data['Contents/header.xml']);h.set('secCnt', str(count));data['Contents/header.xml'] = encode(h)
    c = ET.fromstring(data['Contents/content.hpf'])
    for parent in c.iter():
        for e in list(parent):
            ref = e.get('id', e.get('idref', ''))
            if ref.startswith('section') and int(ref[7:]) >= count: parent.remove(e)
    data['Contents/content.hpf'] = encode(c);data.pop('META-INF/container.rdf', None)
    file = out / (label + '.hwpx')
    with ZipFile(file, 'x') as z:
        for n, b in data.items(): z.writestr(n, b)
    targets = [[owner, 2]]
    if multi: targets.append([1, 2])
    if same_source: targets.append([0, 3])
    rows.append({'case': label, 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                 'targets': targets, 'repeat': 2 if footnote else 1200, 'structural': structural,
                 'kind': 'footnote' if footnote else 'endnote'})


make('minimal-two', structural=True)
make('middle-donor', count=3, owner=1)
make('multiple-donors', count=3, multi=True, structural=True)
make('same-source-two-notes', same_source=True)
make('section-end-control', placement='END_OF_SECTION')
make('last-owner-control', owner=1)
make('single-section-control', count=1)
make('footnote-control', footnote=True)
if len(sys.argv) > 3:
    source = Path(sys.argv[3]);file = out / 'review-exact.hwpx';file.write_bytes(source.read_bytes())
    rows.append({'case': 'review-exact', 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                 'targets': [[0, 2]], 'repeat': 1200, 'structural': False, 'kind': 'endnote'})
(out / 'manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'cases': len(rows)}))
