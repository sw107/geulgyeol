import Foundation
import Vision
let args=CommandLine.arguments
guard args.count==3 else {fatalError("PNG input and new JSON output")}
guard !FileManager.default.fileExists(atPath:args[2]) else {fatalError("fresh output")}
let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.usesLanguageCorrection=false
let supported=try request.supportedRecognitionLanguages();request.recognitionLanguages=["ko-KR","en-US"].filter{supported.contains($0)}
request.customWords=(0..<52).map{String(format:"PRINT_%02d",$0)}+["한글","미리보기","ABC","123","é"]
try VNImageRequestHandler(url:URL(fileURLWithPath:args[1]),options:[:]).perform([request])
let rows=(request.results ?? []).compactMap{item->[String:Any]? in
 guard let text=item.topCandidates(1).first else{return nil};let b=item.boundingBox
 return ["text":text.string,"confidence":text.confidence,"bounds":["x":b.origin.x,"y":b.origin.y,"width":b.width,"height":b.height]]
}
let data=try JSONSerialization.data(withJSONObject:["engine":"on-device Apple Vision OCR","languages":request.recognitionLanguages,"rows":rows],options:[.prettyPrinted,.sortedKeys]);try data.write(to:URL(fileURLWithPath:args[2]),options:.withoutOverwriting)
print("OCR lines \(rows.count)")
