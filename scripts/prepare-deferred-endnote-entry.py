"""CACHE_CHECK_BINARY FRESH_OUTPUT [REVIEW_SEED]; builds only synthetic fixtures."""
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
subprocess.run([sys.executable, str(Path(__file__).with_name('prepare-document-endnote-cache.py')),
                str(binary), str(out / 'base'), *sys.argv[3:]], check=True)
rows = json.loads((out / 'base' / 'manifest.json').read_text())
for name, mixed in [('unequal-render-body', False), ('deferred-and-own', True)]:
    with ZipFile(rows[0]['path']) as z:
        data = {n: z.read(n) for n in z.namelist()}
    roots = [ET.fromstring(data[f'Contents/section{i}.xml']) for i in range(2)]
    for i in range(3):
        paragraph = copy.deepcopy(roots[1][0])
        paragraph.set('id', str(100 + i))
        # Additional body paragraphs must not clone root section/column controls.
        for parent in paragraph.iter():
            for child in list(parent):
                if child.tag.split('}')[-1] in ('secPr', 'ctrl', 'linesegarray'):
                    parent.remove(child)
                elif child.tag.split('}')[-1] == 't':
                    child.text = f'EXTRA_BODY_{i}'
        roots[1].append(paragraph)
    if mixed:
        run = next(r for r in roots[0][0] if any(e.tag.endswith('ctrl') and any(
            c.tag.endswith('endNote') for c in e) for e in r))
        roots[1][0].append(copy.deepcopy(run))
    for i in range(2):
        data[f'Contents/section{i}.xml'] = ET.tostring(roots[i], encoding='utf-8', xml_declaration=True)
    file = out / (name + '.hwpx')
    with ZipFile(file, 'x') as z:
        for n, b in data.items():
            z.writestr(n, b)
    rows.append({'case': name, 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                 'targets': [[0, 2], [1, 2]] if mixed else [[0, 2]], 'kind': 'endnote',
                 'repeat': 1200, 'structural': False})
(out / 'manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'cases': len(rows), 'targets': sum(len(f['targets']) for f in rows)}))
