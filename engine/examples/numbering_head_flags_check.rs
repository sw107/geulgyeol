//! Synthetic cross-format numbering-head regression; no Hancom/GUI claim.
use rhwp::{document_core::DocumentCore, model::style::Numbering, parser::hwpx::header::parse_hwpx_header};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn flags(n:&Numbering)->Vec<u32>{n.heads.iter().map(|h|h.attr & 12).collect()}
fn heads(n:&Numbering)->Value{json!({"heads":n.heads,"formats":n.level_formats,"start":n.start_number,"levelStarts":n.level_start_numbers})}
fn state(d:&DocumentCore,id:usize)->Value{
 let doc=d.document();json!({"numbering":heads(&doc.doc_info.numberings[id-1]),"paragraphs":doc.sections[0].paragraphs.iter().enumerate().map(|(p,v)|json!({"text":v.text,"style":v.style_id,"chars":v.char_shapes,"para":serde_json::from_str::<Value>(&d.get_para_properties_at_native(0,p).unwrap()).unwrap()})).collect::<Vec<_>>(),"svg":(0..d.page_count()).map(|p|blake3::hash(d.render_page_svg_native(p).unwrap().as_bytes()).to_hex().to_string()).collect::<Vec<_>>()})
}
fn write(out:&Path,name:&str,v:&[u8]){let p=out.join(name);assert!(!p.exists());for entry in fs::read_dir(out).unwrap(){let old=entry.unwrap().path();if old.is_file()&&fs::read(&old).unwrap()==v{fs::hard_link(old,p).unwrap();return;}}fs::write(p,v).unwrap();}
fn contracts(fixed:bool)->usize{
 let mut count=0;
 for (inst,auto,bits) in [("0","0",0),("1","0",4),("0","1",8),("1","1",12),("true","false",4),("false","true",8)]{
  for level in [1,7]{for reverse in [false,true]{
   let attrs=if reverse {format!("autoIndent=\"{auto}\" numFormat=\"ROMAN_CAPITAL\" useInstWidth=\"{inst}\"")}else{format!("useInstWidth=\"{inst}\" numFormat=\"ROMAN_CAPITAL\" autoIndent=\"{auto}\"")};
   let raw=format!("<hh:paraHead level=\"{level}\" start=\"0\" {attrs} widthAdjust=\"-12\" textOffset=\"0\" charPrIDRef=\"4294967295\">^1.</hh:paraHead>");
   let xml=format!("<hh:head xmlns:hh=\"http://www.hancom.co.kr/hwpml/2011/head\"><hh:refList><hh:numberings itemCnt=\"1\"><hh:numbering id=\"1\" start=\"0\">{raw}</hh:numbering></hh:numberings></hh:refList></hh:head>");
   let (doc,_) =parse_hwpx_header(&xml).unwrap();let n=&doc.numberings[0];let h=n.heads[level-1];assert_eq!(h.attr&12,if fixed{bits}else{0});assert_eq!(h.attr&!12,2<<5);assert_eq!(h.width_adjust,-12);assert_eq!(h.text_distance,0);assert_eq!(h.char_shape_id,u32::MAX);assert_eq!(n.start_number,0);assert_eq!(n.level_start_numbers[level-1],0);assert_eq!(n.raw_para_heads.as_deref(),Some(raw.as_str()));count+=1;
  }}
 }
 for level in [0,1,7,8]{
  let raw=format!("<hh:paraHead level=\"{level}\" numFormat=\"DIGIT\" charPrIDRef=\"0\"/>");let xml=format!("<hh:head xmlns:hh=\"http://www.hancom.co.kr/hwpml/2011/head\"><hh:refList><hh:numberings><hh:numbering id=\"1\" start=\"0\">{raw}</hh:numbering></hh:numberings></hh:refList></hh:head>");let (doc,_) =parse_hwpx_header(&xml).unwrap();let n=&doc.numberings[0];assert_eq!(flags(n),vec![0;7]);assert_eq!(n.raw_para_heads.as_deref(),Some(raw.as_str()));assert_eq!(n.start_number,0);count+=1;
 }
 count
}
fn main(){let args=std::env::args().collect::<Vec<_>>();assert_eq!(args.len(),4);let fixtures=Path::new(&args[1]);let out=Path::new(&args[2]);assert!(!out.exists());fs::create_dir(out).unwrap();let fixed=args[3]=="fixed";assert!(fixed||args[3]=="baseline");let proof:Value=serde_json::from_slice(&fs::read(fixtures.join("proof.json")).unwrap()).unwrap();let mut rows=Vec::new();
 for fixture in proof["rows"].as_array().unwrap(){let name=fixture["name"].as_str().unwrap();let id=fixture["numberingId"].as_u64().unwrap() as usize;let expected=fixture["expectedFlags"].as_array().unwrap().iter().map(|v|v.as_u64().unwrap() as u32).collect::<Vec<_>>();let bytes=fs::read(fixtures.join(format!("{name}.hwpx"))).unwrap();
  for source in ["hwpx","hwp"]{
   let mut d=DocumentCore::from_bytes(&bytes).unwrap();d.convert_to_editable_native().unwrap();
   if source=="hwp"{let n=&mut d.document_mut().doc_info.numberings[id-1];n.raw_data=None;n.raw_para_heads=None;for (h,b) in n.heads.iter_mut().zip(&expected){h.attr=(h.attr&!12)|b;}let raw=d.export_hwp_with_adapter_snapshot_with_report().unwrap();assert!(raw.content_loss().is_empty());let b=raw.into_bytes();write(out,&format!("{name}-input.hwp"),&b);d=DocumentCore::from_bytes(&b).unwrap();d.convert_to_editable_native().unwrap();}
   let initial=state(&d,id);write(out,&format!("{name}-{source}-initial.json"),&serde_json::to_vec_pretty(&initial).unwrap());let initial_flags=flags(&d.document().doc_info.numberings[id-1]);assert_eq!(initial_flags,if fixed||source=="hwp"{expected.clone()}else{vec![0;7]});
   let mut stages=Vec::new();for (index,target) in ["hwpx","hwp","hwpx","hwp","hwpx"].iter().enumerate(){let artifact=if *target=="hwp"{d.export_hwp_with_adapter_snapshot_with_report()}else{d.export_hwpx_native_with_report()}.unwrap();assert!(artifact.content_loss().is_empty());let b=artifact.into_bytes();write(out,&format!("{name}-{source}-{index}.{target}"),&b);d=DocumentCore::from_bytes(&b).unwrap();d.convert_to_editable_native().unwrap();let s=state(&d,id);write(out,&format!("{name}-{source}-{index}.json"),&serde_json::to_vec_pretty(&s).unwrap());let observed=flags(&d.document().doc_info.numberings[id-1]);assert_eq!(observed,if fixed{expected.clone()}else{vec![0;7]});assert_eq!(s["paragraphs"],initial["paragraphs"]);assert_eq!(s["svg"],initial["svg"]);if fixed{assert_eq!(s["numbering"],initial["numbering"]);}stages.push(json!({"target":target,"flags":observed,"textStylesLayoutEqual":true}));}
   rows.push(json!({"name":name,"source":source,"expectedFlags":expected,"initialFlags":initial_flags,"stages":stages,"lossReproduced":!fixed&&expected!=vec![0;7]}));
  }
 }
 let p=json!({"mode":args[3],"native":true,"contractCases":contracts(fixed),"rows":rows,"HancomVerified":false,"GUIVerified":false});write(out,"proof.json",&serde_json::to_vec_pretty(&p).unwrap());println!("{}",json!({"mode":args[3],"contractCases":p["contractCases"],"documentPaths":p["rows"].as_array().unwrap().len(),"saveReopens":30}));}
