"""MANIFEST FRESH_PROOF OUTPUT_DIR...; exact equation XML across saved stages."""
import json, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

manifest, proof, *outputs = map(Path, sys.argv[1:])
assert outputs, 'at least one observation directory required'

def canonical(e):
    # Attribute order is XML syntax; every actual attribute value is retained.
    return [e.tag, sorted(e.attrib.items()), e.text or '', [canonical(c) for c in e]]

def equations(p):
    with zipfile.ZipFile(p) as z:
        return [canonical(e) for n in sorted(z.namelist())
                if n.startswith('Contents/section') and n.endswith('.xml')
                for e in ET.fromstring(z.read(n)).iter()
                if e.tag.rsplit('}', 1)[-1] == 'equation']

fixtures = json.loads(manifest.read_text())
count = 0
for f in fixtures:
    expected = equations(Path(f['path']))
    for out in outputs:
        for stage in ['before', 'grown', 'undo', 'redo']:
            assert equations(out / (f['case'] + '-' + stage + '.hwpx')) == expected, (out, f['case'], stage)
            count += 1
result = {'filesVerified': count, 'cases': len(fixtures),
          'exactEquationXMLPreserved': True, 'normalizedAttributes': False}
with proof.open('x') as out:
    out.write(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
