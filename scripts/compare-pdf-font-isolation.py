"""Summarize bounded synthetic PDFKit text and visible font-isolation cases.

Character inventory retention is distinct from reading order and exact search.
No PDF or PNG is modified. Native UI results are separate observer evidence.
"""
import collections,hashlib,json,re,sys,unicodedata
from pathlib import Path
EXPECTED='PRINT_00한글미리보기ABC123é'
def compact(s):return re.sub(r'\s','',unicodedata.normalize('NFC',s))
def case_bodies(text):
    parts=re.split(r'CASE_(\d{2}) ([^\n]+)\n',text)
    if len(parts)!=22:raise ValueError('exactly seven labeled synthetic cases required')
    rows=[]
    for i in range(1,len(parts),3):
        index=int(parts[i]);body=parts[i+2];normal=compact(body)
        if index!=len(rows):raise ValueError('missing, duplicate or reordered case')
        rows.append({'index':index,'case':parts[i+1],'extractedText':body,'allExpectedCharactersRetained':collections.Counter(normal)==collections.Counter(EXPECTED),'expectedReadingOrderExactIgnoringWhitespace':normal==EXPECTED,'koreanPhrasePresent':'한글미리보기' in normal})
    return rows
def font_types(pdf):
    data=Path(pdf).read_bytes()
    if len(data)>1048576 or b'/ObjStm' in data:raise ValueError('bounded uncompressed object dictionaries only')
    fonts=[]
    # Only metadata of the known generated files; this is not a full PDF parser.
    for m in re.finditer(rb'(\d+) 0 obj\s*(.*?)endobj',data,re.S):
        d=m[2].split(b'stream',1)[0]
        if re.search(rb'/Type\s*/Font\b',d):
            subtype=re.search(rb'/Subtype\s*/(\w+)',d);font=re.search(rb'/BaseFont\s*/([^\s/>]+)',d)
            fonts.append({'object':int(m[1]),'subtype':subtype[1].decode() if subtype else None,'baseFont':font[1].decode() if font else None,'ToUnicode':b'/ToUnicode' in d})
    return {'originalSHA256':hashlib.sha256(data).hexdigest(),'fileBytes':len(data),'fontDictionaries':fonts,'subtypeCounts':dict(collections.Counter(f['subtype'] for f in fonts))}
def summarize(phase):
    phase=Path(phase);routes=[]
    for route,filename in [('printToPDF','printToPDF-controls.pdf'),('os','os-native-controls.pdf')]:
        inspection=json.loads((phase/f'render-{route}/inspection.json').read_text())
        if inspection['pageCount']!=1:raise ValueError('one-page control matrix required')
        routes.append({'route':route,'pageCount':1,'mediaBox':inspection['pages'][0]['mediaBox'],'cases':case_bodies(inspection['pages'][0]['text']),**font_types(phase/filename)})
    return {'routes':routes,'PDFsModified':False,'exactWordSearchNotInferredFromCharacterInventory':True,'fullProductionDocumentRegression':False}
if __name__=='__main__':
    result={'schema':'geulgyeol-pdf-font-isolation-v1','matrices':[summarize(p) for p in sys.argv[1:-1]]}
    with Path(sys.argv[-1]).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps([{'routes':[{'route':r['route'],'retainedCases':[c['index'] for c in r['cases'] if c['allExpectedCharactersRetained']],'subtypes':r['subtypeCounts']} for r in m['routes']]} for m in result['matrices']]))
