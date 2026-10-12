import json,hashlib,copy,xml.etree.ElementTree as ET
from pathlib import Path
import sys
r=Path(__file__).resolve().parents[1];old=Path(sys.argv[1]).resolve();p=Path(sys.argv[2]).resolve()
svg=ET.parse(old).getroot();alltext=[e for e in svg if e.tag.endswith('}text')];baseline=min(float(e.attrib['y']) for e in alltext);first=[e for e in alltext if float(e.attrib['y'])==baseline];assert len(first)==21
ET.register_namespace('','http://www.w3.org/2000/svg');rows=[];cases=[]
for i,kind in enumerate(['CFF-original','TT-original-length','TT-no-length','TT-spacing-only','TT-length-075','TT-length-125']):
 out=ET.Element('{http://www.w3.org/2000/svg}svg',{'width':'530','height':'44','viewBox':f'100 {baseline-20} 340 28'})
 for original in first:
  e=copy.deepcopy(original)
  if i:e.attrib['font-family']='Noto Sans KR'
  if kind=='TT-no-length':e.attrib.pop('textLength',None);e.attrib.pop('lengthAdjust',None)
  if kind=='TT-spacing-only' and 'lengthAdjust' in e.attrib:e.attrib['lengthAdjust']='spacing'
  if kind in ['TT-length-075','TT-length-125'] and 'textLength' in e.attrib:e.attrib['textLength']=str(float(e.attrib['textLength'])*(.75 if kind.endswith('075') else 1.25))
  out.append(e)
 rows.append(f'<section data-case="{kind}"><h2>CASE_{i:02} {kind}</h2>'+ET.tostring(out,encoding='unicode')+'</section>');cases.append({'case':kind,'index':i,'xYPreserved':True,'visualEquivalenceNotAssumed':True})
rows.append('<section data-case="TT-html"><h2>CASE_06 TT-html</h2><p style="font:20.78px \'Noto Sans KR\';margin-left:20.86px">PRINT_00 한글 미리보기 ABC 123 é</p></section>')
url=(r/'desktop/web/studio/fonts/NotoSansKR-Regular.woff2').as_uri()
css='''@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font:12px Arial,sans-serif;color:#000;background:white}h1{font-size:15px}h2{font-size:12px;margin:0 0 5px}section{height:122px;break-inside:avoid;border-top:1px solid #ddd;padding-top:6px}svg{display:block}@media print{button,#status{display:none}}'''
html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Geulgyeol TrueType print isolation</title><style>'+css+'</style><style id="rhwp-web-font-faces">@font-face{font-family:"Noto Sans KR";src:url("'+url+'") format("woff2");font-display:block}</style></head><body><h1>Visible font-format and length controls; no product substitution</h1><button id="print" disabled>Print controls</button><p id="status">Waiting for bundled font</p>'+''.join(rows)+'''<script>
(async()=>{await document.fonts.load('13.333px "Noto Sans KR"','PRINT_00한글미리보기ABC123é');await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);window.syntheticIsolation={ready:true,fontFaces:[...document.fonts].map(f=>({family:f.family,status:f.status})),evidence:[...document.querySelectorAll('section')].map(s=>({case:s.dataset.case,text:s.textContent,glyphs:[...s.querySelectorAll('text')].map(t=>({x:t.getAttribute('x'),y:t.getAttribute('y'),text:t.textContent,font:t.getAttribute('font-family'),length:t.getAttribute('textLength'),lengthAdjust:t.getAttribute('lengthAdjust')}))}))};document.querySelector('#print').disabled=false;document.querySelector('#status').textContent='Bundled TrueType font loaded';})();document.querySelector('#print').addEventListener('click',()=>window.print());
</script></body></html>'''
with (p/'controls.html').open('x') as f:f.write(html)
with (p/'preparation.json').open('x') as f:json.dump({'cases':cases,'controlOnly':True,'noProductFontChange':True,'localFontSHA256':hashlib.sha256((r/'desktop/web/studio/fonts/NotoSansKR-Regular.woff2').read_bytes()).hexdigest(),'sfntFlavor':'00010000 TrueType','htmlSHA256':hashlib.sha256(html.encode()).hexdigest()},f,indent=2)
main=(r/'scripts/check-electron-pdf-font-isolation.cjs').read_text()
with (p/'electron-print-isolation.cjs').open('x') as f:f.write(main)
with (p/'electron-qa-serial-poll.cjs').open('xb') as f:f.write((r/'scripts/electron-qa-serial-poll.cjs').read_bytes())
print('prepared bounded CFF/TrueType/length controls from existing font and synthetic SVG')
