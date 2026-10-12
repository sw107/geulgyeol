"""Prepare visible synthetic controls only; no app launch or PDF creation."""
import hashlib,json,xml.etree.ElementTree as ET,copy
from pathlib import Path
import sys
source=Path(sys.argv[1]).resolve();phase=Path(sys.argv[2]).resolve()
assert phase.exists() and not (phase/'controls.html').exists()
svg=ET.parse(source).getroot();texts=[e for e in svg if e.tag.endswith('}text')];baseline=min(float(e.attrib['y']) for e in texts);first=[e for e in texts if float(e.attrib['y'])==baseline]
assert len(first)==21 and ''.join(e.text or '' for e in first)=='PRINT_00한글미리보기ABC123é'
configs=[('engine-original','none'),('remove-length-attributes','remove-length'),('spacing-only','spacing'),('font-Arial','Arial'),('font-Apple-SD-Gothic-Neo','Apple SD Gothic Neo')]
sections=[];cases=[]
ET.register_namespace('','http://www.w3.org/2000/svg')
for index,(name,change) in enumerate(configs):
 out=ET.Element('{http://www.w3.org/2000/svg}svg',{'width':'530','height':'44','viewBox':f'100 {baseline-20} 340 28','data-case':name})
 for original in first:
  e=copy.deepcopy(original)
  if change=='remove-length':e.attrib.pop('textLength',None);e.attrib.pop('lengthAdjust',None)
  elif change=='spacing' and 'lengthAdjust' in e.attrib:e.attrib['lengthAdjust']='spacing'
  elif change in ['Arial','Apple SD Gothic Neo']:e.attrib['font-family']=change
  out.append(e)
 rendered=ET.tostring(out,encoding='unicode')
 sections.append(f'<section data-case="{name}"><h2>CASE_{index:02} {name}</h2>{rendered}</section>')
 cases.append({'id':name,'index':index,'factorChanged':change,'textNodes':len(first),'sourceBaseline':baseline,'sourceGlyphCoordinatesPreserved':True,'candidateOnly':change!='none','svgSHA256':hashlib.sha256(rendered.encode()).hexdigest()})
sections.append('<section data-case="svg-single-run"><h2>CASE_05 svg-single-run</h2><svg width="530" height="44" viewBox="100 0 340 28"><text x="113.38666666666667" y="20" font-family="Arial" font-size="13.333333333333334">PRINT_00 한글 미리보기 ABC 123 é</text></svg></section>')
sections.append('<section data-case="html-single-run"><h2>CASE_06 html-single-run</h2><p class="html-run">PRINT_00 한글 미리보기 ABC 123 é</p></section>')
html='''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Geulgyeol synthetic text print isolation</title><style>
@page {size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:black;background:white;font:12px Arial,sans-serif}h1{font-size:15px}section{height:122px;break-inside:avoid;border-top:1px solid #ddd;padding-top:6px}h2{font-size:12px;margin:0 0 5px}svg{display:block}.html-run{font:20.784px Arial,sans-serif;margin:0 0 0 20.866px}button{padding:8px}@media print{button,#status{display:none}}
</style></head><body><h1>Visible synthetic controls: candidate changes only</h1><button id="print" disabled>Print controls</button><p id="status">Waiting for fonts and layout</p>'''+''.join(sections)+'''<script>
(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const evidence=[...document.querySelectorAll('section')].map(s=>({case:s.dataset.case,rect:{width:s.getBoundingClientRect().width,height:s.getBoundingClientRect().height},glyphs:[...s.querySelectorAll('text')].map(t=>({text:t.textContent,x:t.getAttribute('x'),y:t.getAttribute('y'),font:t.getAttribute('font-family'),length:t.getAttribute('textLength'),lengthAdjust:t.getAttribute('lengthAdjust')}))}));window.syntheticIsolation={ready:true,evidence};document.querySelector('#print').disabled=false;document.querySelector('#status').textContent='Ready; visible controls only';})();document.querySelector('#print').addEventListener('click',()=>window.print());
</script></body></html>'''
with (phase/'controls.html').open('x') as f:f.write(html)
manifest={'schema':'geulgyeol-visible-print-isolation-v1','sourcePreviewProductSHA':'0fcd046e30f23831222dac9621bad197dce67661','currentMain':'a6d9cfec2add44dd1fee97ee905478de02667e0d','preparedOnly':True,'appLaunched':False,'nativeOSPDFExecuted':False,'printToPDFExecuted':False,'cases':cases,'additionalControls':['svg-single-run','html-single-run'],'noInvisibleDuplicateText':True,'notProductFix':True,'originalSVGSourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'htmlSHA256':hashlib.sha256(html.encode()).hexdigest(),'status':'blocked on Preview QA-window close confirmation; prepared controls do not prove cause or layout equivalence'}
with (phase/'preparation.json').open('x') as f:json.dump(manifest,f,indent=2);f.write('\n')
print(json.dumps({'preparedCases':len(configs)+2,'bytes':len(html.encode()),'executed':False}))
