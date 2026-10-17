"""Create a synthetic two-section HWPX seed without changing its source."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import re
import sys

source, output = map(Path, sys.argv[1:3])
assert not output.exists(), "fresh output required"
with ZipFile(source) as z:
    files = {n: z.read(n) for n in z.namelist()}
assert "Contents/section1.xml" not in files, "single-section synthetic seed required"
content = files["Contents/content.hpf"].decode()
item = re.search(r'<opf:item\b[^>]*\bid="section0"[^>]*/>', content)
spine = re.search(r'<opf:itemref\b[^>]*\bidref="section0"[^>]*/>', content)
assert item and spine, "expected section manifest and spine"
content = content.replace(item[0], item[0] + item[0].replace('id="section0"', 'id="section1"').replace("section0.xml", "section1.xml"))
content = content.replace(spine[0], spine[0] + spine[0].replace('idref="section0"', 'idref="section1"'))
files["Contents/content.hpf"] = content.encode()
files["Contents/section1.xml"] = files["Contents/section0.xml"]
header = files["Contents/header.xml"].decode()
assert 'secCnt="1"' in header
files["Contents/header.xml"] = header.replace('secCnt="1"', 'secCnt="2"', 1).encode()
with ZipFile(output, "x", compression=ZIP_DEFLATED) as z:
    for name, data in files.items():
        z.writestr(name, data)
print(hashlib.sha256(output.read_bytes()).hexdigest())
