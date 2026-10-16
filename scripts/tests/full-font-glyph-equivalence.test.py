"""Controlled synthetic TrueType/WOFF2 tests, not native rendering claims."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import io
from pathlib import Path
import unittest
from types import SimpleNamespace
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.ttProgram import Program
from fontTools.ttLib.woff2 import WOFF2FlavorData

source = Path(__file__).resolve().parents[1] / 'check-nanum-full-glyph-equivalence.py'
spec = importlib.util.spec_from_file_location('glyph_equivalence', source)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def serialize(font):
    output = io.BytesIO()
    font.save(output)
    return output.getvalue()


def fixture():
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(['.notdef', 'A', 'hidden.simple', 'hidden.composite'])
    fb.setupCharacterMap({65: 'A'})
    glyphs = {}
    for name, width in [('.notdef', 200), ('A', 500), ('hidden.simple', 300)]:
        pen = TTGlyphPen(None)
        pen.moveTo((0, 0)); pen.lineTo((width, 0)); pen.lineTo((width, 500)); pen.closePath()
        glyphs[name] = pen.glyph()
    program = Program(); program.fromBytecode([0xB0, 0, 0x21])
    glyphs['hidden.simple'].program = program
    pen = TTGlyphPen(glyphs); pen.addComponent('A', (0.5, 0, 0, 0.5, 20, 30))
    glyphs['hidden.composite'] = pen.glyph()
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'Synthetic Glyph QA', 'styleName': 'Regular', 'uniqueFontIdentifier': 'SyntheticGlyphQA',
                       'fullName': 'Synthetic Glyph QA Regular', 'psName': 'SyntheticGlyphQA-Regular', 'version': 'Version 1.0'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost(); fb.setupMaxp()
    prep = newTable('prep'); prep.program = Program(); prep.program.fromBytecode([0xB0, 0, 0x21]); fb.font['prep'] = prep
    return serialize(fb.font)


def candidate(data, kind='official-full-woff2-transformed', mutate=None):
    with TTFont(io.BytesIO(data), recalcTimestamp=False) as font:
        if mutate:
            mutate(font)
        if 'DSIG' in font:
            del font['DSIG']
        font.flavor = 'woff2'
        font.flavorData = WOFF2FlavorData(transformedTables=set() if kind.endswith('-null') else {'glyf', 'loca'})
        return serialize(font)


class GlyphEquivalenceTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()
        self.reference = audit.snapshot_font(self.data)

    def compare(self, payload, kind='official-full-woff2-transformed'):
        return audit.compare_snapshots(self.reference, audit.snapshot_font(payload), kind, payload)

    def test_both_profiles_cover_unmapped_glyphs_and_notdef(self):
        self.assertEqual(self.reference['stats']['glyphs'], 4)
        self.assertEqual(self.reference['stats']['unmappedGlyphs'], 3)
        for kind in audit.FULL_KINDS:
            result = self.compare(candidate(self.data, kind), kind)
            self.assertEqual(result['glyphsCompared'], 4)
            self.assertEqual(result['unmappedGlyphsCompared'], 3)
            self.assertTrue(result['notdefCompared'])

    def test_unmapped_outline_mutation_is_detected(self):
        def mutate(font):
            font['glyf']['hidden.simple'].coordinates[1] = (301, 0)
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_unmapped_hint_program_mutation_is_detected(self):
        def mutate(font):
            font['glyf']['hidden.simple'].program.fromBytecode([0xB0, 1, 0x21])
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_unmapped_metric_mutation_is_detected(self):
        def mutate(font):
            font['hmtx'].metrics['hidden.simple'] = (601, 0)
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_component_metric_flag_is_detected(self):
        def mutate(font):
            font['glyf']['hidden.composite'].components[0].flags ^= 0x0200
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_overlap_flag_is_detected(self):
        def mutate(font):
            font['glyf']['hidden.simple'].flags[0] ^= 0x40
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_global_program_mutation_is_detected(self):
        def mutate(font):
            font['prep'].program.fromBytecode([0xB0, 1, 0x21])
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_name_metadata_mutation_is_detected(self):
        def mutate(font):
            font['name'].setName('Changed Name', 1, 3, 1, 0x409)
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_head_change_beyond_required_bit_is_detected(self):
        def mutate(font):
            font['head'].flags ^= 0x4000
        with self.assertRaises(AssertionError):
            self.compare(candidate(self.data, mutate=mutate))

    def test_null_and_standard_labels_cannot_be_swapped(self):
        for actual, declared in [(audit.FULL_KINDS[0], audit.FULL_KINDS[1]), (audit.FULL_KINDS[1], audit.FULL_KINDS[0])]:
            with self.assertRaises(AssertionError):
                self.compare(candidate(self.data, actual), declared)

    def test_zero_contour_bounds_are_not_dropped(self):
        glyph = SimpleNamespace(numberOfContours=0, xMin=0, yMin=0, xMax=10, yMax=0)
        before = audit.glyph_record(glyph)
        self.assertEqual(before['bbox'], [0, 0, 10, 0])
        glyph.xMax = 11
        self.assertNotEqual(before, audit.glyph_record(glyph))

    def test_point_attachment_indices_are_preserved(self):
        component = SimpleNamespace(glyphName='A', flags=0, firstPt=1, secondPt=2)
        glyph = SimpleNamespace(numberOfContours=-1, xMin=0, yMin=0, xMax=500, yMax=500, components=[component])
        before = audit.glyph_record(glyph)
        self.assertEqual(before['components'][0]['placement'], {'points': [1, 2]})
        component.secondPt = 3
        self.assertNotEqual(before, audit.glyph_record(glyph))

    def test_unknown_component_fields_are_rejected(self):
        component = SimpleNamespace(glyphName='A', flags=0, x=0, y=0, unknown=1)
        glyph = SimpleNamespace(numberOfContours=-1, xMin=0, yMin=0, xMax=500, yMax=500, components=[component])
        with self.assertRaises(AssertionError):
            audit.glyph_record(glyph)


if __name__ == '__main__':
    unittest.main()
