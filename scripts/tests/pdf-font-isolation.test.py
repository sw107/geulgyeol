import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('comparison',Path(__file__).parents[1]/'compare-pdf-font-isolation.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def text(body=None):return 'Heading\n'+''.join(f'CASE_{i:02} synthetic\n{m.EXPECTED if body is None else body}\n' for i in range(7))
class DiagnosticSensitivity(unittest.TestCase):
    def test_exact_inventory_and_order(self):self.assertTrue(all(r['allExpectedCharactersRetained'] and r['expectedReadingOrderExactIgnoringWhitespace'] for r in m.case_bodies(text())))
    def test_header_only_does_not_prove_body(self):self.assertFalse(any(r['allExpectedCharactersRetained'] for r in m.case_bodies(text(''))))
    def test_missing_korean_rejected(self):self.assertFalse(any(r['allExpectedCharactersRetained'] for r in m.case_bodies(text(m.EXPECTED.replace('한','')))))
    def test_duplicate_glyph_rejected(self):self.assertFalse(any(r['allExpectedCharactersRetained'] for r in m.case_bodies(text(m.EXPECTED+'é'))))
    def test_inventory_does_not_claim_reading_order(self):
        rows=m.case_bodies(text(m.EXPECTED.replace('_','')+'_'));self.assertTrue(all(r['allExpectedCharactersRetained'] for r in rows));self.assertFalse(any(r['expectedReadingOrderExactIgnoringWhitespace'] for r in rows))
    def test_missing_case_rejected(self):
        with self.assertRaises(ValueError):m.case_bodies(text().replace('CASE_06 synthetic\n'+m.EXPECTED+'\n',''))
    def test_reordered_case_rejected(self):
        with self.assertRaises(ValueError):m.case_bodies(text().replace('CASE_00','CASE_09'))
if __name__=='__main__':unittest.main()
