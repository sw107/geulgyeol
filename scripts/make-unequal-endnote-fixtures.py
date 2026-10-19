"""Generate only synthetic copies. Usage: python3 SCRIPT FRESH_OUTPUT_DIR."""
from pathlib import Path
import hashlib
import json
import re
import sys
import zipfile

repo = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve()
output.mkdir()
seeds = repo / "engine/examples/fixtures"
unique = "".join(f"{i:03d}_한글😀 " for i in range(160))
specs = [
    ("seed", [9000, 19250], "TEXT_한글😀 " * 160, None, True),
    ("unique", [9000, 19250], unique, None, True),
    ("reverse", [19250, 9000], unique, None, True),
    ("three", [6000, 9000, 12500], unique, None, True),
    ("long", [9000, 19250], "".join(f"{i:04d}_가😀나 " for i in range(600)), None, True),
    ("unicode", [9000, 19250], "가😀나😺AB " * 210, None, True),
    ("mixed-style", [9000, 19250], unique, "mixed", True),
    ("zero-indent", [9000, 19250], unique, "zero", True),
    ("indent-rejected", [9000, 19250], unique, "indent", False),
    ("too-narrow-rejected", [800, 27450], unique, None, False),
    ("equation-rejected", [9000, 19250], unique, "equation", False),
    ("multi-para-rejected", [9000, 19250], unique, "multi", False),
]
fixtures = []
for name, widths, text, kind, supported in specs:
    seed = seeds / ("endnote-equation-tail.hwpx" if kind in ("equation", "multi")
                    else "endnote-unequal-two.hwpx")
    with zipfile.ZipFile(seed) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    data = {info.filename: content for info, content in entries}
    section = data["Contents/section0.xml"].decode()
    columns = (f'<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="{len(widths)}" '
               'sameSz="0" sameGap="750">' + "".join(
                   f'<hp:colSz width="{width}" gap="{750 if i + 1 < len(widths) else 0}"/>'
                   for i, width in enumerate(widths)) + '</hp:colPr>')
    section, count = re.subn(r'<hp:colPr\b[^>]*(?:/>|>.*?</hp:colPr>)',
                             lambda _: columns, section, count=1)
    assert count == 1
    if kind in ("zero", "indent"):
        header = data["Contents/header.xml"].decode()
        header, count = re.subn(
            r'<hh:paraPr\b[^>]*\bid="10".*?</hh:paraPr>',
            lambda match: re.sub(r'(<hc:intent value=")[^"]*',
                                 lambda m: m[1] + ("0" if kind == "zero" else "500"),
                                 match[0]), header, count=1)
        assert count == 1
        data["Contents/header.xml"] = header.encode()
    if kind == "mixed":
        section, count = re.subn(
            r'(<hp:endNote\b[^>]*>.*?)(<hp:run charPrIDRef="3"><hp:t>N1P0_END</hp:t></hp:run>)',
            lambda m: m[1] + '<hp:run charPrIDRef="3"><hp:t>N1P0</hp:t></hp:run>'
            '<hp:run charPrIDRef="0"><hp:t>_END</hp:t></hp:run>', section, count=1)
        assert count == 1
    if kind == "multi":
        note = re.search(r'<hp:endNote\b.*?</hp:endNote>', section)[0]
        paragraphs = re.findall(r'<hp:p\b.*?</hp:p>', note)
        assert len(paragraphs) == 2
        tail = re.sub(r'<hp:run\b.*?</hp:run>', '', paragraphs[1])
        tail = re.sub(r'<hp:linesegarray>.*?</hp:linesegarray>', '', tail)
        tail = tail.replace('</hp:p>', '<hp:run charPrIDRef="3"><hp:t>PLAIN_TAIL</hp:t></hp:run></hp:p>')
        section = section.replace(paragraphs[1], tail, 1)
    data["Contents/section0.xml"] = section.encode()
    path = output / f"{name}.hwpx"
    with zipfile.ZipFile(path, "x") as archive:
        for info, _ in entries:
            archive.writestr(info, data[info.filename])
    fixtures.append({
        "case": name, "path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "supported": supported, "expectedPages": None,
        "actions": [{"section": 0, "para": 0, "control": 2, "notePara": 0, "text": text}],
        "targets": [{"section": 0, "para": 0, "control": 2}],
    })
(output / "manifest.json").write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n")
print(f"Created {len(fixtures)} synthetic fixtures in {output}")
