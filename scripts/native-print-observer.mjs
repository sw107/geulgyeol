// Serialized into the preview renderer by the QA runner. No outer bindings.
export function installNativePrintObserver(key) {
 const original=window.__qaNativePrintOriginal??window.print;
 window.__qaNativePrintOriginal=original;
 window.print=function(...args){
  console.info('[qa-native-print-called] '+key);
  return original.apply(this,args);
 };
}
