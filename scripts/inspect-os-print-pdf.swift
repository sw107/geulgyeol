import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func rect(_ r: CGRect) -> [String:Double] { ["x":r.origin.x,"y":r.origin.y,"width":r.width,"height":r.height] }
let args=CommandLine.arguments
guard args.count==3 else { fatalError("input PDF and fresh output directory required") }
let input=URL(fileURLWithPath:args[1]),out=URL(fileURLWithPath:args[2])
guard !FileManager.default.fileExists(atPath:out.path) else {fatalError("fresh output required")}
try FileManager.default.createDirectory(at:out,withIntermediateDirectories:false)
guard let doc=PDFDocument(url:input),let cg=CGPDFDocument(input as CFURL) else {fatalError("cannot open PDF")}
guard doc.pageCount>0&&doc.pageCount<=8 else {fatalError("bounded synthetic PDF pages")}
var pages:[[String:Any]]=[]
for i in 0..<doc.pageCount {
 let page=doc.page(at:i)!,cgp=cg.page(at:i+1)!,box=page.bounds(for:.mediaBox)
 let text=page.string ?? "",n=text as NSString
 var tokens:[[String:Any]]=[]
 for k in 0..<52 {
  let label=String(format:"PRINT_%02d",k),range=n.range(of:label)
  if range.location != NSNotFound,let selection=page.selection(for:range) {tokens.append(["label":label,"bounds":rect(selection.bounds(for:page))])}
 }
 let scale=2.0,w=Int(ceil(box.width*scale)),h=Int(ceil(box.height*scale))
 guard w>0&&h>0&&w<=2400&&h<=3400 else {fatalError("bounded rendering")}
 let ctx=CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 ctx.setFillColor(CGColor(gray:1,alpha:1));ctx.fill(CGRect(x:0,y:0,width:w,height:h))
 ctx.scaleBy(x:scale,y:scale);ctx.translateBy(x:-box.minX,y:-box.minY);ctx.drawPDFPage(cgp)
 let image=ctx.makeImage()!,file=out.appendingPathComponent("page-\(i+1).png")
 guard let dest=CGImageDestinationCreateWithURL(file as CFURL,UTType.png.identifier as CFString,1,nil) else {fatalError("PNG destination")}
 CGImageDestinationAddImage(dest,image,nil);guard CGImageDestinationFinalize(dest) else {fatalError("PNG render failed")}
 pages.append(["page":i+1,"mediaBox":rect(box),"cropBox":rect(page.bounds(for:.cropBox)),"rotation":page.rotation,"text":text,"tokens":tokens,"png":file.lastPathComponent,"pixelWidth":w,"pixelHeight":h])
}
var attributes:[String:String]=[:]
for (key,value) in doc.documentAttributes ?? [:] {attributes[String(describing:key)]=String(describing:value)}
let result:[String:Any]=["renderer":"macOS PDFKit/CoreGraphics","dpi":144,"pageCount":doc.pageCount,"attributes":attributes,"pages":pages]
let data=try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]);try data.write(to:out.appendingPathComponent("inspection.json"),options:.withoutOverwriting)
print("PDF pages=\(doc.pageCount), rendered all pages at144dpi")
