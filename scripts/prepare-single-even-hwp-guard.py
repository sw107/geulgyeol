"""NATIVE_BINARY FRESH_OUTPUT: self-contained synthetic Even HWP guard fixtures."""
from pathlib import Path
from zipfile import ZipFile
import copy, hashlib, json, subprocess, sys, xml.etree.ElementTree as ET

binary, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
out.mkdir()
subprocess.run([str(binary), 'seed', str(out / 'seed')], check=True)
hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
local = lambda e: e.tag.split('}')[-1]
encode = lambda e: ET.tostring(e, encoding='utf-8', xml_declaration=True)
with ZipFile(out / 'seed' / 'source-three-physical.hwpx') as z:
    source = {n: z.read(n) for n in z.namelist()}
rows = []

def make(label, declarations, types, restart=None, first_two=False, second_two=False, texts=None):
    data = dict(source)
    used = {mi for refs in declarations for mi in refs}
    for mi in used:
        root = ET.fromstring(source[f'Contents/masterpage{min(mi, 1)}.xml'])
        root.set('id', f'masterpage{mi}')
        root.set('type', types[mi])
        for e in root.iter():
            if local(e) == 't': e.text = texts.get(mi, f'MASTER_{mi}') if texts else f'MASTER_{mi}'
        data[f'Contents/masterpage{mi}.xml'] = encode(root)
    expected = []
    for si, refs in enumerate(declarations):
        root = ET.fromstring(source[f'Contents/section{min(si, 1)}.xml'])
        p = root[0]
        for e in p.iter():
            if local(e) == 't': e.text = f'BODY_{si}'
        sd = next(e for e in p.iter() if local(e) == 'secPr')
        for e in list(sd):
            if local(e) == 'masterPage': sd.remove(e)
        for mi in refs: ET.SubElement(sd, f'{{{hp}}}masterPage', {'idRef': f'masterpage{mi}'})
        sd.set('masterPageCnt', str(len(refs)))
        if si == 1 and restart is not None:
            run = ET.SubElement(p, f'{{{hp}}}run', {'charPrIDRef': '0'})
            ctrl = ET.SubElement(run, f'{{{hp}}}ctrl')
            ET.SubElement(ctrl, f'{{{hp}}}newNum', {'num': str(restart), 'numType': 'PAGE'})
        if (si == 0 and first_two) or (si == 1 and second_two):
            extra = copy.deepcopy(p)
            extra.set('pageBreak', '1')
            for run in list(extra):
                if any(local(e) in ['secPr', 'ctrl'] for e in run): extra.remove(run)
            for e in extra.iter():
                if local(e) == 't': e.text = f'BODY_{si}_CONT'
            root.append(extra)
        data[f'Contents/section{si}.xml'] = encode(root)
        expected.append({'section': si, 'masters': [{'id': mi, 'apply': types[mi], 'text': texts.get(mi, f'MASTER_{mi}') if texts else f'MASTER_{mi}'} for mi in refs],
                         'body': [f'BODY_{si}'] + ([f'BODY_{si}_CONT'] if len(root) == 2 else [])})
    count = len(declarations)
    for n in list(data):
        if n.startswith('Contents/section') and n.endswith('.xml') and int(n[16:-4]) >= count: del data[n]
        if n.startswith('Contents/masterpage') and n.endswith('.xml') and int(n[19:-4]) not in used: del data[n]
    h = ET.fromstring(data['Contents/header.xml']);h.set('secCnt', str(count));data['Contents/header.xml'] = encode(h)
    c = ET.fromstring(data['Contents/content.hpf'])
    manifest = next(e for e in c if local(e) == 'manifest');spine = next(e for e in c if local(e) == 'spine')
    item_tag = manifest[0].tag
    for e in list(manifest):
        if e.get('id', '').startswith(('section', 'masterpage')): manifest.remove(e)
    for si in range(count): ET.SubElement(manifest, item_tag, {'id': f'section{si}', 'href': f'Contents/section{si}.xml', 'media-type': 'application/xml'})
    for mi in sorted(used): ET.SubElement(manifest, item_tag, {'id': f'masterpage{mi}', 'href': f'Contents/masterpage{mi}.xml', 'media-type': 'application/xml'})
    for e in list(spine):
        if e.get('idref', '').startswith('section'): spine.remove(e)
    for si in range(count): ET.SubElement(spine, '{http://www.idpf.org/2007/opf/}itemref', {'idref': f'section{si}', 'linear': 'yes'})
    data['Contents/content.hpf'] = encode(c);data.pop('META-INF/container.rdf', None)
    p = out / (label + '.hwpx')
    with ZipFile(p, 'x') as z:
        for n, b in data.items(): z.writestr(n, b)
    with ZipFile(p) as z:
        assert z.testzip() is None
        for n in z.namelist():
            if n.endswith(('.xml', '.hpf', '.rdf')): ET.fromstring(z.read(n))
    rows.append({'case': label, 'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'expected': expected,
                 'restart': restart, 'firstTwoPages': first_two, 'secondTwoPages': second_two})

make('three-shared', [[0], [1], [0]], {0:'EVEN',1:'ODD'})
make('three-unique', [[0], [1], [2]], {0:'EVEN',1:'ODD',2:'EVEN'})
make('two-odd-even-restart3', [[0], [1]], {0:'ODD',1:'EVEN'}, restart=3)
make('two-odd-even-short', [[0], [1]], {0:'ODD',1:'EVEN'})
make('two-first-two-pages', [[0], [1]], {0:'ODD',1:'EVEN'}, first_two=True)
make('two-second-two-pages', [[0], [1]], {0:'BOTH',1:'EVEN'}, second_two=True)
make('one-even', [[0]], {0:'EVEN'})
make('both-control', [[0], [1]], {0:'BOTH',1:'BOTH'}, restart=3)
make('odd-control', [[0], [1]], {0:'BOTH',1:'ODD'}, second_two=True)
make('explicit-two-slots-control', [[0], [2, 1]], {0:'BOTH',1:'ODD',2:'BOTH'}, restart=3)
make('two-no-odd-carry', [[0], [1]], {0:'EVEN',1:'EVEN'}, restart=3)
make('same-visible-content', [[0], [1]], {0:'ODD',1:'EVEN'}, restart=3, texts={0:'SAME',1:'SAME'})
make('equivalent-two-slots-control', [[0], [1,0]], {0:'ODD',1:'BOTH'}, restart=3)
make('two-odd-both-restart3', [[0], [1]], ['ODD', 'BOTH'], restart=3)
make('one-both-same-payload', [[0]], ['BOTH'])
for name in ['two-odd-even-restart3', 'same-visible-content']:
    f = copy.deepcopy(next(r for r in rows if r['case'] == name))
    with ZipFile(f['path']) as z: data = {n: z.read(n) for n in z.namelist()}
    root = ET.fromstring(data['Contents/masterpage0.xml'])
    for e in root.iter():
        if local(e) == 't': e.text = 'AFTER_0'
    data['Contents/masterpage0.xml'] = encode(root)
    file = out / (name + '-owner-changed.hwpx')
    with ZipFile(file, 'x') as z:
        for n, b in data.items(): z.writestr(n, b)
    f.update(case=name + '-owner-changed', path=str(file), sha256=hashlib.sha256(file.read_bytes()).hexdigest())
    f['expected'][0]['masters'][0]['text'] = 'AFTER_0'
    rows.append(f)
for row in rows:
    row['rejectHwp'] = any(len(s['masters']) == 1 and s['masters'][0]['apply'] == 'EVEN' for s in row['expected'])
(out / 'manifest.json').write_text(json.dumps(rows, indent=2)+'\n')
print(json.dumps({'cases':len(rows)}))
