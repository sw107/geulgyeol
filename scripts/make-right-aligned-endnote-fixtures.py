"""Synthetic RIGHT-note soft-wrap and unchanged-policy controls; creates a new directory."""
from pathlib import Path
import hashlib,html,json,re,sys,zipfile
repo=Path(__file__).resolve().parent.parent;out=Path(sys.argv[1]).resolve();out.mkdir()
unique=''.join(f'{i:03d}가😀 'for i in range(150))
specs=[
 ('right-seed',[9000,19250],unique,'fix',{}),
 ('right-reverse',[19250,9000],unique,'fix',{}),
 ('right-narrow-first',[3000,25250],unique,'fix',{}),
 ('right-three',[6000,9000,12500],unique,'fix',{}),
 ('right-four',[3000,4500,6000,13250],unique,'fix',{}),
 ('right-unicode',[9000,19250],''.join(f'{i:03d}가😺𠀀나 'for i in range(170)),'fix',{}),
 ('right-two-spaces',[9000,19250],''.join(f'{i:03d}가😀  'for i in range(150)),'fix',{}),
 ('right-mixed',[9000,19250],unique,'fix',{'mixed':True}),
 ('right-zero-indent',[9000,19250],unique,'fix',{'indent':0}),
 ('right-equal-columns',[14500,14500],unique,'fix',{}),
 ('right-equal-static-tail',[14500,14500],unique,'fix',{'equation':True}),
 ('right-long',[9000,19250],''.join(f'{i:04d}가😀 'for i in range(500)),'fix',{}),
 ('right-final-spaces',[9000,19250],unique,'preserve-final-spaces',{'finalSpaces':True}),
 ('short-final-spaces',[9000,19250],'짧은 입력 ','preserve-final-spaces',{'finalSpaces':True}),
 ('control-left',[9000,19250],unique,'unchanged',{'align':'LEFT'}),
 ('control-center',[9000,19250],unique,'unchanged',{'align':'CENTER'}),
 ('control-justify',[9000,19250],unique,'unchanged',{'align':'JUSTIFY'}),
 ('control-distribute',[9000,19250],unique,'unchanged',{'align':'DISTRIBUTE'}),
 ('control-split',[9000,19250],unique,'unchanged',{'align':'DISTRIBUTE_SPACE'}),
 ('control-positive-indent',[9000,19250],unique,'unchanged',{'indent':500}),
 ('control-keep-lines',[9000,19250],unique,'unchanged',{'keepLines':True}),
 ('control-unequal-equation',[9000,19250],unique,'unchanged',{'equation':True}),
 ('control-body-right',[9000,19250],unique,'unchanged',{'bodyRight':True}),
]
rows=[]
for name,widths,text,expect,options in specs:
 seed=repo/'engine/examples/fixtures'/('endnote-equation-tail.hwpx'if options.get('equation')else'endnote-unequal-two.hwpx')
 with zipfile.ZipFile(seed)as z:entries=[(i,z.read(i.filename))for i in z.infolist()]
 data={i.filename:b for i,b in entries};s=data['Contents/section0.xml'].decode();h=data['Contents/header.xml'].decode()
 cols=f'<hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="{len(widths)}" sameSz="0" sameGap="750">'+''.join(f'<hp:colSz width="{w}" gap="{750 if i+1<len(widths)else 0}"/>'for i,w in enumerate(widths))+'</hp:colPr>'
 s,n=re.subn(r'<hp:colPr\b[^>]*(?:/>|>.*?</hp:colPr>)',lambda _:cols,s,count=1);assert n==1
 def para(m):
  p=m[0];p=re.sub(r'(<hh:align horizontal=")[^"]*',lambda m:m[1]+options.get('align','RIGHT'),p)
  if 'indent'in options:p=re.sub(r'(<hc:intent value=")[^"]*',lambda m:m[1]+str(options['indent']),p)
  if options.get('keepLines'):p=p.replace('keepLines="0"','keepLines="1"')
  return p
 h,n=re.subn(r'<hh:paraPr\b[^>]*\bid="10".*?</hh:paraPr>',para,h,count=1);assert n==1
 if options.get('mixed'):s=s.replace('<hp:t>N1P0_END</hp:t>','<hp:t>N1P0</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>_END</hp:t>')
 if options.get('finalSpaces'):s=s.replace('N1P0_END','N1P0_END   ')
 if options.get('bodyRight'):
  note=re.search(r'<hp:endNote\b.*?</hp:endNote>',s)[0];s=s.replace(note,note.replace('paraPrIDRef="10"','paraPrIDRef="0"'),1);s=s.replace('<hp:p id="2" paraPrIDRef="0"','<hp:p id="2" paraPrIDRef="10"');s=s.replace('TAIL_0',html.escape(''.join(f'BODY_{i:03d} 'for i in range(100))))
 data['Contents/header.xml']=h.encode();data['Contents/section0.xml']=s.encode();p=out/(name+'.hwpx')
 with zipfile.ZipFile(p,'x')as z:
  for info,_ in entries:z.writestr(info,data[info.filename])
 rows.append({'case':name,'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'supported':expect in ('fix','preserve-final-spaces'),'expect':expect,'targets':[{'section':0,'para':0,'control':2}],'actions':[{'section':0,'para':0,'control':2,'notePara':0,'text':text}]})
(out/'manifest.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'cases':len(rows),'fix':sum(x['expect']=='fix'for x in rows),'unchanged':sum(x['expect']=='unchanged'for x in rows),'preservedParagraphEndSpaces':sum(x['expect']=='preserve-final-spaces'for x in rows)}))
