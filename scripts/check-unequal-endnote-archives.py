"""FRESH_REPORT BASE_NATIVE FIXED_NATIVE BASE_WASM FIXED_WASM directories."""
from pathlib import Path
import json
import sys
import zipfile

report = Path(sys.argv[1])
folders = [Path(p) for p in sys.argv[2:]]
assert len(folders) == 4
names = sorted(p.name for p in folders[0].glob('*.hwpx'))
assert names
for folder in folders[1:]:
    assert names == sorted(p.name for p in folder.glob('*.hwpx'))
comparisons = []
for name in names:
    with zipfile.ZipFile(folders[0] / name) as archive:
        expected = {key: archive.read(key) for key in archive.namelist()}
    for folder in folders[1:]:
        with zipfile.ZipFile(folder / name) as archive:
            actual = {key: archive.read(key) for key in archive.namelist()}
        assert expected == actual, (str(folder / name), [
            key for key in expected.keys() | actual.keys() if expected.get(key) != actual.get(key)])
        comparisons.append({'file': str(folder / name), 'sameEntryContentsAsMainNative': True})
proof = {'archiveFiles': len(names) * 4, 'comparisons': len(comparisons),
         'allArchiveEntryContentsIdentical': True, 'GUIVerified': False, 'rows': comparisons}
with report.open('x') as file:
    file.write(json.dumps(proof, indent=2) + '\n')
print(f'{len(comparisons)} complete archive content comparisons passed')
