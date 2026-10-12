import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('comparison',Path(__file__).parents[1]/'compare-os-print-pdf.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class EvidenceSensitivity(unittest.TestCase):
    def setUp(self):
        self.ref=[dict(text=f'PRINT_{i:02}한글미리보기ABC123é',label=f'PRINT_{i:02}',baseline=20+i*20,left=20,right=120,font=10,accentX=110) for i in range(2)]
        self.ocr=[dict(text=r['text']) for r in self.ref];self.boxes=[[21,11,116,20],[21,31,116,40]]
    def run_rows(self,ocr=None,boxes=None,accents=None,size=(200,100)):
        return module.evaluate_rows(self.ref,self.ocr if ocr is None else ocr,self.boxes if boxes is None else boxes,1,1,size,[True,True] if accents is None else accents)
    def test_valid_fixture(self):self.assertTrue(all(r['passed'] for r in self.run_rows()))
    def test_missing_line_rejected(self):
        with self.assertRaises(AssertionError):self.run_rows(ocr=self.ocr[:1])
    def test_swapped_lines_rejected(self):self.assertFalse(any(r['passed'] for r in self.run_rows(ocr=list(reversed(self.ocr)))))
    def test_wrong_body_rejected(self):
        o=[dict(text=r['text'].replace('ABC','XYZ')) for r in self.ocr];self.assertFalse(any(r['passed'] for r in self.run_rows(ocr=o)))
    def test_baseline_shift_rejected(self):
        b=[[x,y+4,right,bottom+4] for x,y,right,bottom in self.boxes];self.assertFalse(any(r['passed'] for r in self.run_rows(boxes=b)))
    def test_outside_paper_rejected(self):self.assertFalse(any(r['passed'] for r in self.run_rows(size=(110,100))))
    def test_plain_e_requires_actual_accent_ink(self):
        o=[dict(text=r['text'][:-1]+'e') for r in self.ocr];self.assertTrue(all(r['passed'] for r in self.run_rows(ocr=o)));self.assertFalse(any(r['passed'] for r in self.run_rows(ocr=o,accents=[False,False])))
if __name__=='__main__':unittest.main()
