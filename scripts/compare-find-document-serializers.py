"""Compare complete HWP streams/records and HWPX entries from two export prefixes.
Usage: python3 -B scripts/compare-find-document-serializers.py BEFORE AFTER
Each prefix must have .hwp and .hwpx files. JSON is written to stdout only.
Native history QA also compares full files at a common saved caret; this tool
explains raw-file differences without ignoring any document record or ZIP entry.
"""
from pathlib import Path
import json,struct,hashlib,zlib,zipfile,xml.etree.ElementTree as ET,sys
sha=lambda b:hashlib.sha256(b).hexdigest()
def cfb(path):
 b=Path(path).read_bytes();assert b[:8]==bytes.fromhex('d0cf11e0a1b11ae1');assert len(b)<20*1024*1024
 u=lambda off:struct.unpack_from('<I',b,off)[0];ss=1<<struct.unpack_from('<H',b,30)[0];ms=1<<struct.unpack_from('<H',b,32)[0];limit=len(b)//ss
 def sector(s):assert s<limit;return b[(s+1)*ss:(s+2)*ss]
 dif=list(struct.unpack_from('<109I',b,76));sid=u(68)
 for _ in range(u(72)):
  block=struct.unpack('<'+str(ss//4)+'I',sector(sid));dif.extend(block[:-1]);sid=block[-1]
 fat=[]
 for s in [x for x in dif if x<0xfffffffa][:u(44)]:fat.extend(struct.unpack('<'+str(ss//4)+'I',sector(s)))
 def chain(s,table,read):
  out=[];seen=set()
  while s<0xfffffffa:
   assert s not in seen and s<len(table);seen.add(s);assert len(seen)<=limit*8;out.append(read(s));s=table[s]
  return b''.join(out)
 directory=chain(u(48),fat,sector);entries=[]
 for off in range(0,len(directory),128):
  v=directory[off:off+128];name_len=struct.unpack_from('<H',v,64)[0];entries.append({'name':v[:max(0,name_len-2)].decode('utf-16le'),'kind':v[66],'left':struct.unpack_from('<I',v,68)[0],'right':struct.unpack_from('<I',v,72)[0],'child':struct.unpack_from('<I',v,76)[0],'first':struct.unpack_from('<I',v,116)[0],'size':struct.unpack_from('<Q',v,120)[0]})
 root=entries[0];mini=chain(root['first'],fat,sector)[:root['size']];mf=chain(u(60),fat,sector);minifat=list(struct.unpack('<'+str(len(mf)//4)+'I',mf))
 streams={};seen=set()
 def visit(idx,parent=''):
  if idx>=0xfffffffa:return
  assert idx<len(entries) and idx not in seen;seen.add(idx);e=entries[idx];visit(e['left'],parent);name=parent+e['name']
  if e['kind']==1:visit(e['child'],name+'/')
  elif e['kind']==2:
   payload=chain(e['first'],minifat,lambda s:mini[s*ms:(s+1)*ms]) if e['size']<u(56) else chain(e['first'],fat,sector)
   streams[name]=payload[:e['size']]
  visit(e['right'],parent)
 visit(root['child']);return streams

def records(payload):
 rows=[];at=0
 while at<len(payload):
  assert at+4<=len(payload);h=struct.unpack_from('<I',payload,at)[0];at+=4;n=h>>20
  if n==4095:n=struct.unpack_from('<I',payload,at)[0];at+=4
  assert at+n<=len(payload);rows.append((h&1023,(h>>10)&1023,payload[at:at+n]));at+=n
 return rows

def changed_bytes(a,b):return {'beforeLength':len(a),'afterLength':len(b),'beforeSHA256':sha(a),'afterSHA256':sha(b),'offsets':[i for i in range(min(len(a),len(b))) if a[i]!=b[i]][:100],'beforeHex':a.hex() if len(a)<500 else None,'afterHex':b.hex() if len(b)<500 else None}
def compare_hwp(a,b):
 left,right=cfb(a),cfb(b);result={'sameStreamNames':sorted(left)==sorted(right),'streams':{}}
 compressed=bool(struct.unpack_from('<I',left['FileHeader'],36)[0]&1)
 for name in sorted(set(left)|set(right)):
  x,y=left.get(name,b''),right.get(name,b'');item={'rawEqual':x==y}
  if compressed and (name=='DocInfo' or name.startswith('BodyText/')):
   x=zlib.decompress(x,-15);y=zlib.decompress(y,-15);item['decodedEqual']=x==y
   rx,ry=records(x),records(y);item['recordCount']=[len(rx),len(ry)];item['changedRecords']=[]
   for i in range(max(len(rx),len(ry))):
    old=rx[i] if i<len(rx) else None;new=ry[i] if i<len(ry) else None
    if old!=new:item['changedRecords'].append({'index':i,'beforeTagLevel':old[:2] if old else None,'afterTagLevel':new[:2] if new else None,'payload':changed_bytes(old[2] if old else b'',new[2] if new else b'')})
  elif x!=y:item['difference']=changed_bytes(x,y)
  result['streams'][name]=item
 return result

def tree(e):return {'tag':e.tag,'attrs':dict(sorted(e.attrib.items())),'text':e.text,'tail':e.tail,'children':[tree(c) for c in e]}
def compare_hwpx(a,b):
 with zipfile.ZipFile(a) as za,zipfile.ZipFile(b) as zb:
  result={'sameEntryNames':sorted(za.namelist())==sorted(zb.namelist()),'entries':{}}
  for name in sorted(set(za.namelist())|set(zb.namelist())):
   x,y=za.read(name),zb.read(name);item={'bytesEqual':x==y,'zipMetadataEqual':[(i.date_time,i.compress_type,i.external_attr,i.CRC,i.file_size) for i in [za.getinfo(name)] ]==[(i.date_time,i.compress_type,i.external_attr,i.CRC,i.file_size) for i in [zb.getinfo(name)]]}
   if x!=y:
    item['difference']=changed_bytes(x,y)
    try:item['xmlTreeEqual']=tree(ET.fromstring(x))==tree(ET.fromstring(y));item['beforeXML']=x.decode();item['afterXML']=y.decode()
    except (ET.ParseError,UnicodeDecodeError):pass
   result['entries'][name]=item
  return result

if __name__ == '__main__':
 assert len(sys.argv)==3, 'two export prefixes required'
 left,right=sys.argv[1:]
 result={'hwp':compare_hwp(left+'.hwp',right+'.hwp'),
         'hwpx':compare_hwpx(left+'.hwpx',right+'.hwpx')}
 print(json.dumps(result,ensure_ascii=False,indent=2))
