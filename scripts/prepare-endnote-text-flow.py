"""BINARY FRESH_OUTPUT. Generate only synthetic HWPX fixtures, never user files."""
import copy, hashlib, json, subprocess, sys
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

binary, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
out.mkdir()
subprocess.run([str(binary), 'seed', str(out / 'seed')], check=True)
hp = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
local = lambda e: e.tag.split('}')[-1]
rows = []

def make(name, sections=1, widths=None, notes=None, height=84186, margin=1500,
         columns=1, exact=None, separator=False, between=0, paragraph_spacing=False,
         auto_marker=False, leading=False):
    with ZipFile(out / 'seed/seed-3.hwpx') as z:
        data = {n: z.read(n) for n in z.namelist()}
    roots = [ET.fromstring(data[f'Contents/section{i}.xml']) for i in range(3)]
    template = next(e for e in roots[0].iter() if local(e) == 'endNote')
    note_template = copy.deepcopy(template)
    para_template = copy.deepcopy(next(e for e in template.iter() if local(e) == 'p'))
    # Remove the seed note; insert a known note sequence below.
    for root in roots:
        for parent in root.iter():
            for e in list(parent):
                if local(e) == 'ctrl' and any(local(c) == 'endNote' for c in e): parent.remove(e)
    widths = widths or [59528] * sections
    for i in range(sections):
        sd = next(e for e in roots[i].iter() if local(e) == 'secPr')
        page = next(e for e in sd if local(e) == 'pagePr')
        page.set('width', str(widths[i])); page.set('height', str(height))
        mg = next(e for e in page if local(e) == 'margin')
        for key in ['left', 'right', 'top', 'bottom']: mg.set(key, str(margin))
        mg.set('header', '0'); mg.set('footer', '0'); mg.set('gutter', '0')
        en = next(e for e in sd if local(e) == 'endNotePr')
        spacing = next(e for e in en if local(e) == 'noteSpacing')
        spacing.attrib.update(betweenNotes=str(between), aboveLine='224' if separator else '0', belowLine='567' if separator else '0')
        line = next(e for e in en if local(e) == 'noteLine')
        line.set('length', '12280' if separator else '0')
        line.set('type', 'SOLID' if separator else 'NONE')
        cp = next(e for e in roots[i].iter() if local(e) == 'colPr')
        cp.set('colCount', str(columns)); cp.set('sameGap', '750' if columns > 1 else '0')
        # Independent body paragraphs before and after the reference anchor.
        anchor = roots[i][0]
        for ls in list(anchor):
            if local(ls) == 'linesegarray': anchor.remove(ls)
        tail = copy.deepcopy(anchor)
        for e in tail.iter():
            if local(e) == 't': e.text = f'TAIL_{i}'
        for parent in tail.iter():
            for e in list(parent):
                if local(e) in ['secPr', 'ctrl', 'linesegarray']: parent.remove(e)
        if exact is None: roots[i].append(tail)
    targets=[]; actions=[]
    for number, (si, lengths) in enumerate(notes or [(0, [1200])], 1):
        note = copy.deepcopy(note_template); note.set('number', str(number))
        sub = next(e for e in note if local(e) == 'subList'); sub.clear()
        for ni, repeat in enumerate(lengths):
            p=copy.deepcopy(para_template)
            for e in list(p): p.remove(e)
            run=ET.SubElement(p, f'{{{hp}}}run', {'charPrIDRef':'3'})
            ET.SubElement(run, f'{{{hp}}}t').text = '' if repeat == -1 else ('  ' if leading else '')+f'N{number}P{ni}_END'
            if auto_marker and ni == 0:
                ctrl = copy.deepcopy(next(e for e in para_template.iter() if local(e) == 'ctrl'))
                for e in ctrl.iter():
                    if local(e) == 'autoNum': e.set('num', str(number))
                run.append(ctrl)
            sub.append(p)
            if repeat > 0:
                token = f'N{number}P{ni}_한글😀 '
                actions.append({'section':si,'para':0,'control':2+sum(t['section']==si for t in targets),'notePara':ni,'text':token*repeat})
        run=ET.SubElement(roots[si][0], f'{{{hp}}}run', {'charPrIDRef':'0'})
        ctrl=ET.SubElement(run, f'{{{hp}}}ctrl');ctrl.append(note)
        targets.append({'section':si,'para':0,'control':2+sum(t['section']==si for t in targets)})
    for i in range(sections): data[f'Contents/section{i}.xml']=ET.tostring(roots[i],encoding='utf-8',xml_declaration=True)
    for i in range(sections,3): del data[f'Contents/section{i}.xml']
    header=ET.fromstring(data['Contents/header.xml']);header.set('secCnt',str(sections))
    if paragraph_spacing:
        style=next(e for e in header.iter() if local(e)=='paraPr' and e.get('id')=='10')
        for e in style.iter():
            tag=local(e)
            if tag in ['prev','next','left','right','intent']:
                e.set('value',str({'prev':600,'next':300,'left':900,'right':700,'intent':750}[tag]))
    data['Contents/header.xml']=ET.tostring(header)
    content=ET.fromstring(data['Contents/content.hpf'])
    for parent in content.iter():
        for e in list(parent):
            ref=e.get('id',e.get('idref',''))
            if ref.startswith('section') and int(ref[7:])>=sections:parent.remove(e)
    data['Contents/content.hpf']=ET.tostring(content);data.pop('META-INF/container.rdf',None)
    file=out/(name+'.hwpx')
    with ZipFile(file,'x') as z:
        for n,b in data.items():z.writestr(n,b)
    rows.append({'case':name,'path':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'targets':targets,'actions':actions,'expectedPages':exact})

make('single-long')
make('several-paragraphs',notes=[(0,[400,300,200])])
make('several-notes',notes=[(0,[250,0]),(0,[350,250]),(0,[0,300])])
make('different-widths',sections=2,widths=[59528,30000],notes=[(0,[600,200])])
make('narrow-to-wide',sections=2,widths=[30000,59528],notes=[(0,[600])])
make('multiple-donors',sections=3,widths=[59528,42000,30000],notes=[(0,[200,150]),(1,[250]),(2,[300,0])])
make('short-page',height=16000,widths=[32000],notes=[(0,[350,250])])
make('large-margins',height=30000,margin=6000,widths=[42000],notes=[(0,[400])])
make('equal-two-columns',columns=2,notes=[(0,[600,300]),(0,[250])])
make('empty-note',notes=[(0,[-1])])
make('empty-among-paragraphs',notes=[(0,[300,-1,300])])
make('visible-separator',separator=True,notes=[(0,[700,200])])
make('between-note-gap',height=22000,between=3000,notes=[(0,[120]),(0,[200]),(0,[80])])
make('paragraph-margins',height=24000,widths=[36000],paragraph_spacing=True,notes=[(0,[250,200,150])])
make('automatic-note-marker',auto_marker=True,notes=[(0,[400,150]),(0,[300])])
make('leading-source-spaces',leading=True,notes=[(0,[200,0])])
# Independent geometry: body 1600 HU + ten 900+270 HU note line advances.
# The last line's trailing gap is reserved, so exactly fitting is conservative.
make('exact-fit',height=15300,margin=1000,notes=[(0,[0]*10)],exact=1)
make('one-line-over',height=15300,margin=1000,notes=[(0,[0]*11)],exact=2)
(out/'manifest.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'cases':len(rows)}))
