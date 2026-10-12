"""Bounded synthetic OS-PDF evidence checker; no PDF/image edits."""
import hashlib,json,math,re,sys,unicodedata,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image,ImageChops

def normalized(s):return re.sub(r'\s','',unicodedata.normalize('NFC',s))
def source_rows(svg):
    root=ET.parse(svg).getroot();groups={}
    for e in root.iter():
        if e.tag.endswith('}text'):
            if 'x' not in e.attrib or 'y' not in e.attrib:raise ValueError('synthetic flat text only')
            groups.setdefault(float(e.attrib['y']),[]).append(dict(x=float(e.attrib['x']),text=e.text or '',font=float(e.attrib['font-size']),advance=float(e.attrib.get('textLength','0'))))
    rows=[]
    for y,g in sorted(groups.items()):
        g.sort(key=lambda x:x['x']);text=''.join(t['text'] for t in g);label=re.match(r'PRINT_\d{2}',text)
        if not label or not text.endswith('é'):raise ValueError('expected fixed synthetic text')
        rows.append(dict(text=text,label=label[0],baseline=y,left=min(t['x'] for t in g),right=max(t['x']+(t['advance'] or t['font']) for t in g),font=max(t['font'] for t in g),accentX=g[-1]['x']))
    return float(root.attrib['width']),float(root.attrib['height']),rows

def ink_rows(image):
    image=image.convert('L');data=image.tobytes();width,height=image.size;bands=[];active=None
    for y in range(height):
        xs=[x for x,v in enumerate(data[y*width:(y+1)*width]) if v<160]
        if xs:
            if active and y-active[3]<=4:active=[min(active[0],min(xs)),active[1],max(active[2],max(xs)),y]
            else:
                if active:bands.append(active)
                active=[min(xs),y,max(xs),y]
    if active:bands.append(active)
    return bands

def accent_present(image,reference,sx,sy):
    # This fixture ends each line with é. Check the separate acute mark above
    # the e body, rather than silently accepting OCR's plain-e substitution.
    left=math.floor(reference['accentX']*sx);top=math.floor((reference['baseline']-reference['font'])*sy)
    right=math.ceil((reference['accentX']+reference['font'])*sx);bottom=math.ceil((reference['baseline']+reference['font']*.2)*sy)
    im=image.convert('L').crop((left,top,right,bottom));width,height=im.size;data=im.tobytes();points={(x,y) for y in range(height) for x in range(width) if data[y*width+x]<160};components=[]
    while points:
        start=points.pop();todo=[start];component=[start]
        while todo:
            x,y=todo.pop()
            for dx in [-1,0,1]:
                for dy in [-1,0,1]:
                    q=(x+dx,y+dy)
                    if q in points:points.remove(q);todo.append(q);component.append(q)
        components.append(component)
    if not components:return False
    body=max(components,key=len);body_top=min(y for x,y in body)
    return any(len(c)>=2 and max(y for x,y in c)<body_top-1 for c in components if c is not body)

def evaluate_rows(reference,ocr,boxes,sx,sy,image_size,accents):
    if not(len(reference)==len(ocr)==len(boxes)==len(accents)):raise AssertionError('missing or extra row')
    rows=[]
    for r,o,b,accent in zip(reference,ocr,boxes,accents):
        actual=normalized(o['text']);expected=normalized(r['text']);exact=actual==expected
        ocr_accent_only=actual==expected[:-1]+'e'
        body=exact or (ocr_accent_only and accent)
        baseline_delta=b[3]-r['baseline']*sy
        left_bearing=b[0]-r['left']*sx
        envelope=b[0]>=r['left']*sx-1 and b[2]<=r['right']*sx+1 and b[1]>=(r['baseline']-r['font'])*sy-1 and b[3]<=(r['baseline']+r['font']*.2)*sy+1
        in_page=0<b[0]<b[2]<image_size[0]-1 and 0<b[1]<b[3]<image_size[1]-1
        passed=body and accent and abs(baseline_delta)<=2 and 0<=left_bearing<=r['font']*sx*.2 and envelope and in_page
        rows.append(dict(label=r['label'],OCRBodyExact=exact,OCRAccentOnlyDifference=ocr_accent_only,accentInkAboveBody=accent,bodyVerifiedWithGlyphEvidence=body,inkBox=b,baselineDeltaPixels=baseline_delta,leftBearingPixels=left_bearing,insideSourceFontEnvelope=envelope,insidePaper=in_page,passed=passed))
    return rows

def main(phase):
    q=Path(phase)/'qa';output=q/'comparison.json';assert not output.exists(),'fresh comparison evidence'
    formats=[];all_passed=True
    for f in ['hwp','hwpx']:
        info=json.loads((q/f'render-{f}/inspection.json').read_text());assert info['pageCount']==2
        pages=[];labels=[]
        for n in [1,2]:
            width,height,reference=source_rows(q/f'reference/{f}-page-{n}.svg');image=Image.open(q/f'render-{f}/page-{n}.png');sx,sy=image.width/width,image.height/height
            ocr=json.loads((q/f'render-{f}/ocr-{n}.json').read_text())['rows'];boxes=ink_rows(image);accents=[accent_present(image,r,sx,sy) for r in reference];rows=evaluate_rows(reference,ocr,boxes,sx,sy,image.size,accents)
            labels += [r['label'] for r in rows];passed=all(r['passed'] for r in rows);all_passed &= passed
            pages.append(dict(page=n,mediaBox=info['pages'][n-1]['mediaBox'],sourceSvgWidth=width,sourceSvgHeight=height,renderWidth=image.width,renderHeight=image.height,rows=rows,passed=passed))
        assert labels==[f'PRINT_{i:02}' for i in range(52)],'all rows on matching pages in original order'
        assert len(pages[0]['rows'])==41 and len(pages[1]['rows'])==11
        formats.append(dict(format=f,pageCount=2,all52RowsInOriginalOrder=True,pages=pages))
    equal=[]
    for n in [1,2]:
        a=Image.open(q/f'render-hwp/page-{n}.png').convert('RGB');b=Image.open(q/f'render-hwpx/page-{n}.png').convert('RGB');same=ImageChops.difference(a,b).getbbox() is None;all_passed &= same;equal.append(dict(page=n,allPixelsEqual=same))
    result=dict(schema='geulgyeol-os-pdf-comparison-v1',productSHA='0fcd046e30f23831222dac9621bad197dce67661',route='actual macOS print panel PDF save',ElectronPrintToPDFExecuted=False,PDFsModified=False,baselineTolerancePixels=2,dpi=144,OCRAccentsAcceptedWithoutInkEvidence=False,strictOCRAccentDifferences=sum(r['OCRAccentOnlyDifference'] for f in formats for p in f['pages'] for r in p['rows']),formats=formats,crossFormatRenderComparison=equal,passed=bool(all_passed))
    output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(passed=all_passed,rows=sum(len(p['rows']) for f in formats for p in f['pages']),strictOCRAccentDifferences=result['strictOCRAccentDifferences'],failed=[r for f in formats for p in f['pages'] for r in p['rows'] if not r['passed']]),indent=2))
    if not all_passed:raise SystemExit(1)

if __name__=='__main__':main(sys.argv[1])
