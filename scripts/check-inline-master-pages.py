"""Native byte-fixture regression. BINARY is the built inline_master_pages_check example."""
from pathlib import Path
from zipfile import ZipFile
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

binary, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
output.mkdir()
for prefix, uri in [('hp','http://www.hancom.co.kr/hwpml/2011/paragraph'),('hs','http://www.hancom.co.kr/hwpml/2011/section'),('opf','http://www.idpf.org/2007/opf/'),('dc','http://purl.org/dc/elements/1.1/')]:
    ET.register_namespace(prefix, uri)
local = lambda e: e.tag.split('}')[-1]
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

def run_native(mode, dest, files=()):
    r = subprocess.run([str(binary), mode, str(dest), *map(str, files)], capture_output=True, text=True)
    (output / (dest.name + '.log')).write_text(r.stdout + r.stderr)
    assert r.returncode == 0, dest

run_native('seed', output / 'seed')
run_native('guards', output / 'guards')
with ZipFile(output / 'seed/distinct-sections.hwpx') as z:
    source = {n: z.read(n) for n in z.namelist()}
    infos = z.infolist()

def parse(data, name): return ET.fromstring(data[name])
def encode(root): return ET.tostring(root, encoding='utf-8', xml_declaration=True)
def append_part(data, number):
    root = parse(data, 'Contents/masterpage0.xml')
    root.set('id', f'masterpage{number}')
    for e in root.iter():
        if local(e) == 't' and e.text == 'MASTER_0': e.text = f'MASTER_{number}'
    name = f'Contents/masterpage{number}.xml'
    data[name] = encode(root)
    content = parse(data, 'Contents/content.hpf')
    manifest = next(e for e in content if local(e) == 'manifest')
    tag = next(iter(manifest)).tag
    ET.SubElement(manifest, tag, {'id': f'masterpage{number}', 'href': name, 'media-type': 'application/xml'})
    data['Contents/content.hpf'] = encode(content)

def base():
    data = dict(source)
    first, second = parse(data, 'Contents/section0.xml'), parse(data, 'Contents/section1.xml')
    first.extend(list(second))
    data['Contents/section0.xml'] = encode(first)
    del data['Contents/section1.xml']
    data['Contents/header.xml'] = data['Contents/header.xml'].replace(b'secCnt="2"', b'secCnt="1"', 1)
    content = parse(data, 'Contents/content.hpf')
    for p in content.iter():
        for c in list(p):
            if c.attrib.get('id') == 'section1' or c.attrib.get('idref') == 'section1': p.remove(c)
    data['Contents/content.hpf'] = encode(content)
    if 'META-INF/container.rdf' in data:
        root = parse(data, 'META-INF/container.rdf')
        for p in root.iter():
            for c in list(p):
                if 'Contents/section1.xml' in c.attrib.values(): p.remove(c)
        data['META-INF/container.rdf'] = encode(root)
    return data

def remove_part(data, number):
    data.pop(f'Contents/masterpage{number}.xml')
    content = parse(data, 'Contents/content.hpf')
    for p in content.iter():
        for c in list(p):
            if c.attrib.get('id') == f'masterpage{number}': p.remove(c)
    data['Contents/content.hpf'] = encode(content)

def expected(data):
    content = parse(data, 'Contents/content.hpf')
    hrefs = {e.attrib['id']: e.attrib['href'] for e in content.iter() if local(e) == 'item'}
    sections = []
    spine = next(e for e in content if local(e) == 'spine')
    for item in spine:
        root = parse(data, hrefs[item.attrib['idref']])
        if local(root) != 'sec': continue
        si = len(sections)
        owners, body = [], []
        for pi, p in enumerate(root):
            body.append(''.join(t.text or '' for r in p if local(r) == 'run' for t in r if local(t) == 't'))
            for r in p:
                for sd in r:
                    if local(sd) != 'secPr': continue
                    masters, seen = [], set()
                    for ref in sd:
                        if local(ref) != 'masterPage': continue
                        href = hrefs[ref.attrib['idRef']]
                        if href in seen: continue
                        seen.add(href)
                        mp = parse(data, href)
                        sub = next(e for e in mp if local(e) == 'subList')
                        kind = mp.attrib['type']
                        masters.append({'text': '|'.join(''.join(t.text or '' for r in p if local(r) == 'run' for t in r if local(t) == 't') for p in sub if local(p) == 'p'),
                            'apply': {'EVEN':'Even','ODD':'Odd'}.get(kind, 'Both'), 'extension':kind in ['LAST_PAGE','OPTIONAL_PAGE'],
                            'width':int(sub.attrib['textWidth']), 'height':int(sub.attrib['textHeight']), 'direction':int(sub.attrib.get('textDirection') == 'VERTICAL'),
                            'front':mp.attrib.get('pageFront') == '1'})
                    page = next(e for e in sd if local(e) == 'pagePr')
                    owners.append({'para':pi, 'width':int(page.attrib['width']), 'masters':masters})
        sections.append({'section':si, 'width':owners[0]['width'], 'outerMasters':owners[0]['masters'], 'controls':owners, 'body':body})
    return sections

inputs = output / 'inputs'
inputs.mkdir()
rows = []
def save(name, data, error=None):
    file = inputs / (name + '.hwpx')
    with ZipFile(file, 'x') as z:
        for info in infos:
            if info.filename in data: z.writestr(copy.copy(info), data[info.filename])
        for n in data.keys() - {i.filename for i in infos}: z.writestr(n, data[n])
    with ZipFile(file) as z:
        assert z.testzip() is None
        for n in z.namelist():
            if n.endswith(('.xml','.hpf','.rdf')): ET.fromstring(z.read(n))
    rows.append({'label':name, 'path':str(file), 'sha256':sha(file), 'expectedError':error,
                 'expected':None if error else expected(data)})

save('explicit-distinct', base())
data = base(); root = parse(data,'Contents/section0.xml'); root.remove(root[1]); data['Contents/section0.xml'] = encode(root); remove_part(data,1)
save('single-first-owner',data)
pure = {n:b for n,b in data.items() if n != 'META-INF/rhwp-hwp5-origin'}; save('pure-single-first-owner',pure)
data = dict(source); root = parse(data,'Contents/section0.xml'); sd = next(e for e in root.iter() if local(e) == 'secPr'); sd.set('masterPageCnt','0')
for ref in list(sd):
    if local(ref) == 'masterPage': sd.remove(ref)
data['Contents/section0.xml'] = encode(root); remove_part(data,0); save('single-empty-plus-physical',data)

data = base(); root = parse(data, 'Contents/section0.xml')
next(e for e in root[1].iter() if local(e) == 'pagePr').set('width','59528'); data['Contents/section0.xml'] = encode(root)
save('same-geometry', data)
data = base(); root = parse(data, 'Contents/section0.xml'); sd = next(e for e in root[0].iter() if local(e) == 'secPr'); sd.set('masterPageCnt','0')
for c in list(sd):
    if local(c) == 'masterPage': sd.remove(c)
data['Contents/section0.xml'] = encode(root); remove_part(data,0); save('empty-first',data)
data = base(); root = parse(data,'Contents/section0.xml'); next(e for e in root[1].iter() if local(e) == 'masterPage').set('idRef','masterpage0'); data['Contents/section0.xml'] = encode(root); remove_part(data,1); save('shared-part',data)
data = base(); content = parse(data,'Contents/content.hpf'); manifest = next(e for e in content if local(e) == 'manifest'); ms = [e for e in manifest if e.attrib.get('id','').startswith('masterpage')]
for e in ms: manifest.remove(e)
manifest.extend(reversed(ms)); data['Contents/content.hpf'] = encode(content); save('reversed-manifest',data)
data = base(); root = parse(data,'Contents/section0.xml'); sd = next(e for e in root[0].iter() if local(e) == 'secPr'); sd.append(copy.deepcopy(next(e for e in sd if local(e) == 'masterPage'))); data['Contents/section0.xml'] = encode(root); save('local-duplicate-ref',data)
data = base()
for n,kind in [(0,'EVEN'),(1,'ODD')]:
    mp = parse(data,f'Contents/masterpage{n}.xml'); mp.set('type',kind); data[f'Contents/masterpage{n}.xml'] = encode(mp)
save('odd-even',data); rows[-1]['hwpUnsupported'] = True
data = base(); append_part(data,2)
for n,kind in [(1,'ODD'),(2,'EVEN')]:
    mp = parse(data,f'Contents/masterpage{n}.xml'); mp.set('type',kind); data[f'Contents/masterpage{n}.xml'] = encode(mp)
root = parse(data,'Contents/section0.xml'); sd = next(e for e in root[1].iter() if local(e) == 'secPr'); ref = copy.deepcopy(next(e for e in sd if local(e) == 'masterPage')); ref.set('idRef','masterpage2'); sd.append(ref); sd.set('masterPageCnt','2'); data['Contents/section0.xml'] = encode(root); save('two-inline-masters',data); rows[-1]['hwpUnsupported'] = True
data = base(); append_part(data,2); data['Contents/section1.xml'] = source['Contents/section1.xml'].replace(b'idRef="masterpage1"',b'idRef="masterpage2"').replace(b'BODY_1',b'BODY_2'); data['Contents/header.xml'] = source['Contents/header.xml']
content = parse(data,'Contents/content.hpf'); original = parse(source,'Contents/content.hpf')
for tag in ['manifest','spine']:
    parent = next(e for e in content if local(e) == tag); src = next(e for e in original if local(e) == tag)
    for e in src:
        if e.attrib.get('id') == 'section1' or e.attrib.get('idref') == 'section1': parent.append(copy.deepcopy(e))
data['Contents/content.hpf'] = encode(content); save('inline-plus-physical',data)

# Cover both HWP-origin HWPX and native HWPX. The established pure-HWPX
# HWP adapter splits inline secPr boundaries into physical SectionN streams.
for original_name in ['explicit-distinct', 'empty-first', 'inline-plus-physical']:
    with ZipFile(inputs/(original_name+'.hwpx')) as z: pure = {n:z.read(n) for n in z.namelist() if n != 'META-INF/rhwp-hwp5-origin'}
    save('pure-'+original_name,pure); rows[-1]['hwpSplit'] = True

data = base(); root = parse(data,'Contents/section0.xml'); next(e for e in root[1].iter() if local(e) == 'masterPage').set('idRef','MISSING'); data['Contents/section0.xml'] = encode(root); save('bad-reference',data,'unresolved')
data = base(); data.pop('Contents/masterpage1.xml'); save('missing-part',data,'masterpage1')
data = base(); root = parse(data,'Contents/section0.xml'); sd = next(e for e in root[1].iter() if local(e) == 'secPr')
for ref in list(sd):
    if local(ref) == 'masterPage': sd.remove(ref)
data['Contents/section0.xml'] = encode(root); save('partially-missing-reference',data,'no explicit owner')
data = base(); root = parse(data,'Contents/section0.xml')
for sd in [e for e in root.iter() if local(e) == 'secPr']:
    for ref in list(sd):
        if local(ref) == 'masterPage': sd.remove(ref)
data['Contents/section0.xml'] = encode(root); save('no-explicit-references',data,'no explicit')
data = base(); content = parse(data,'Contents/content.hpf'); manifest = next(e for e in content if local(e) == 'manifest'); manifest.append(copy.deepcopy(next(e for e in manifest if e.attrib.get('id') == 'masterpage0'))); data['Contents/content.hpf'] = encode(content); save('duplicate-manifest-id',data,'duplicate manifest')
data = base(); root = parse(data,'Contents/section0.xml'); root[0].extend(list(root[1])); root.remove(root[1]); data['Contents/section0.xml'] = encode(root); save('same-paragraph-owners',data,'ownership')
data = base(); root = parse(data,'Contents/section0.xml'); third = copy.deepcopy(root[1]); next(e for e in third.iter() if local(e) == 'masterPage').set('idRef','masterpage0'); root.append(third)
for run in root[0]:
    for child in list(run):
        if local(child) == 'secPr': run.remove(child)
data['Contents/section0.xml'] = encode(root); save('missing-first-owner',data,'first secPr')
data = base(); root = parse(data,'Contents/section0.xml')
for run in root[0]:
    for child in list(run):
        if local(child) == 'secPr': run.remove(child)
data['Contents/section0.xml'] = encode(root); save('only-later-owner',data,'first-paragraph owner')
data = base(); append_part(data,2); save('unreferenced-part',data)
with ZipFile(output/'guards/nested-placeholder.hwpx') as z: data = {n:z.read(n) for n in z.namelist()}
data['Contents/masterpage1.xml'] = source['Contents/masterpage1.xml']; root = parse(data,'Contents/section0.xml'); nested = [e for e in root.iter() if local(e) == 'secPr'][1]; ref = copy.deepcopy(next(e for e in root.iter() if local(e) == 'masterPage')); ref.set('idRef','masterpage1'); nested.append(ref); nested.set('masterPageCnt','1'); data['Contents/section0.xml'] = encode(root)
content = parse(data,'Contents/content.hpf'); manifest = next(e for e in content if local(e) == 'manifest'); item = copy.deepcopy(next(e for e in manifest if e.attrib.get('id') == 'masterpage0')); item.set('id','masterpage1'); item.set('href','Contents/masterpage1.xml'); manifest.append(item); data['Contents/content.hpf'] = encode(content); save('nested-owner',data,'nested secPr')
root = parse(data,'Contents/section0.xml')
for run in root[0]:
    for child in list(run):
        if local(child) == 'secPr': run.remove(child)
data['Contents/section0.xml'] = encode(root); save('only-nested-owner',data,'first-paragraph owner')

for n in [0,1]:
    file = output/'guards'/f'extension-{n}.hwpx'
    with ZipFile(file) as z: data = {p:z.read(p) for p in z.namelist()}
    dest = inputs/file.name; shutil.copy2(file,dest); rows.append({'label':dest.stem,'path':str(dest),'sha256':sha(dest),'expectedError':None,'hwpUnsupported':True,'expected':expected(data)})
for name,source_path,exp in [('control-inline-hwp',output/'seed/inline-model-export.hwp',json.loads((output/'seed/inline-model-before.json').read_text())),('control-sections-hwp',output/'seed/distinct-sections.hwp',expected(source)),('control-sections-hwpx',output/'seed/distinct-sections.hwpx',expected(source))]:
    dest = inputs/(name+source_path.suffix); shutil.copy2(source_path,dest); rows.append({'label':name,'path':str(dest),'sha256':sha(dest),'expectedError':None,'expected':exp})
def hwp_expected(value, split):
    if not split: return copy.deepcopy(value)
    result = []
    for section in value:
        owners = section['controls']
        for i, owner in enumerate(owners):
            start = owner['para']; end = owners[i+1]['para'] if i+1 < len(owners) else len(section['body'])
            result.append({'section':len(result), 'width':owner['width'], 'outerMasters':copy.deepcopy(owner['masters']),
                'controls':[{**copy.deepcopy(owner),'para':0}], 'body':section['body'][start:end]})
    return result

for row in rows:
    if row.get('hwpSplit'): row['expectedHwp'] = hwp_expected(row['expected'],True)
(output/'input-manifest.json').write_text(json.dumps({'cases':rows},ensure_ascii=False,indent=2)+'\n')
run_native('inspect',output/'native',[r['path'] for r in rows])

def normalized(value):
    result = copy.deepcopy(value)
    for section in result:
        for control in section['controls']:
            if control['para'] == 0 and not control['masters']: control['masters'] = section['outerMasters']
    return result

positive, refused = 0, 0
for row in rows:
    name = row['label']; dest = output/'native'
    assert sha(row['path']) == row['sha256']
    if row['expectedError']:
        error = (dest/(name+'-load-error.txt')).read_text(); assert row['expectedError'].lower() in error.lower(),(name,error); refused += 1; continue
    expected_value = normalized(row['expected']); loaded = normalized(json.loads((dest/(name+'-loaded.json')).read_text())); assert loaded == expected_value,(name,'loaded',loaded,expected_value)
    for stage in ['', '-edited']:
        wanted = copy.deepcopy(expected_value)
        if stage: wanted[-1]['body'][-1] += ' EDIT'
        for fmt in ['hwp','hwpx']:
            if row.get('hwpUnsupported') and fmt == 'hwp':
                assert 'owner' in (dest/(name+stage+'-hwp-error.txt')).read_text(); continue
            target = normalized(hwp_expected(wanted,row.get('hwpSplit'))) if fmt == 'hwp' else wanted
            got = normalized(json.loads((dest/(name+stage+'-'+fmt+'-reopened.json')).read_text()))
            assert got == target,(name,stage,fmt,got,target)
    positive += 1
counts = json.loads((output/'native/counts.json').read_text()); assert counts['loads'] == positive
proof = {'positiveInputs':positive,'rejectedAmbiguousInputs':refused,'native':counts,'unchangedExportGuards':json.loads((output/'guards/guards.json').read_text()),'sourceSHA256':sha(Path(__file__)),'binarySHA256':sha(binary),'GUIVerified':False}
(output/'proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n'); print(json.dumps(proof))
