#!/usr/bin/env python3
"""Reuse the cached Native oracle without rebuilding Rust.

The strict oracle includes saved HWP caret bytes and their provenance seals in
DocInfo. Run every manifest row separately and retain strict failures. Only a
DOCUMENT_PROPERTIES caret difference is accepted by the bounded comparison;
paragraphs, controls, BinData, typed DocInfo and every other raw record stay exact.
This reads diagnostic output; it never changes a document or executable.
"""
import argparse
import copy
import hashlib
import json
import pathlib
import re
import struct
import subprocess


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ValueDebug:
    """Small parser for serde_json::Value's Rust Debug representation; no eval."""

    def __init__(self, text):
        self.text, self.at = text, 0

    def whitespace(self):
        while self.at < len(self.text) and self.text[self.at].isspace():
            self.at += 1

    def take(self, token):
        self.whitespace()
        assert self.text.startswith(token, self.at), (token, self.at)
        self.at += len(token)

    def string(self):
        self.take('"')
        result = []
        escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b',
                   'f': '\f', '0': '\0', '"': '"', '\\': '\\'}
        while self.at < len(self.text):
            char = self.text[self.at]
            self.at += 1
            if char == '"':
                return ''.join(result)
            if char == '\\':
                char = self.text[self.at]
                self.at += 1
                if char == 'u':
                    self.take('{')
                    end = self.text.index('}', self.at)
                    result.append(chr(int(self.text[self.at:end], 16)))
                    self.at = end + 1
                else:
                    assert char in escapes, char
                    result.append(escapes[char])
            else:
                result.append(char)
        raise AssertionError('Unterminated Rust string')

    def value(self):
        self.whitespace()
        if self.text.startswith('Object {', self.at):
            self.take('Object {')
            result = {}
            self.whitespace()
            while self.text[self.at] != '}':
                key = self.string()
                assert key not in result
                self.take(':')
                result[key] = self.value()
                self.whitespace()
                if self.text[self.at] == ',':
                    self.at += 1
                    self.whitespace()
                else:
                    break
            self.take('}')
            return result
        if self.text.startswith('Array [', self.at):
            self.take('Array [')
            result = []
            self.whitespace()
            while self.text[self.at] != ']':
                result.append(self.value())
                self.whitespace()
                if self.text[self.at] == ',':
                    self.at += 1
                    self.whitespace()
                else:
                    break
            self.take(']')
            return result
        if self.text.startswith('String(', self.at):
            self.take('String(')
            result = self.string()
            self.take(')')
            return result
        for prefix in ['Number(', 'Bool(']:
            if self.text.startswith(prefix, self.at):
                self.take(prefix)
                end = self.text.index(')', self.at)
                result = json.loads(self.text[self.at:end])
                self.at = end + 1
                return result
        self.take('Null')
        return None

    def parse(self):
        result = self.value()
        self.whitespace()
        assert self.at == len(self.text)
        return result


def option_field(text, name):
    """Find one unambiguous Option field and its end, respecting quoted strings."""
    marker = ', ' + name + ': '
    assert text.count(marker) == 1, name
    start = text.index(marker) + len(marker)
    if text.startswith('None', start):
        return start, start + 4, None
    assert text.startswith('Some(', start), name
    depth, quoted, escaped = 0, False, False
    for end in range(start + 4, len(text)):
        char = text[end]
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                return start, end + 1, text[start + 5:end]
    raise AssertionError('Unterminated Option: ' + name)


def doc_info(text):
    start, end, raw = option_field(text, 'raw_stream')
    raw = bytes(json.loads(raw)) if raw is not None else None
    normalized = text[:start] + 'None' + text[end:]
    start, end, seal = option_field(normalized, 'raw_provenance')
    normalized = normalized[:start] + 'None' + normalized[end:]
    return normalized, raw, seal


def records(raw):
    result, at = [], 0
    while at < len(raw):
        begin = at
        assert at + 4 <= len(raw)
        header, = struct.unpack_from('<I', raw, at)
        at += 4
        tag, level, size = header & 1023, (header >> 10) & 1023, header >> 20
        if size == 4095:
            assert at + 4 <= len(raw)
            size, = struct.unpack_from('<I', raw, at)
            at += 4
        assert at + size <= len(raw)
        result.append((tag, level, raw[begin:at], raw[at:at + size]))
        at += size
    return result


def other_seals(seal):
    assert seal is not None and seal.startswith('DocInfoSeal { ')
    for name in ['model_digest', 'raw_digest', 'props']:
        pattern = r'\b' + name + r': (\[[0-9, ]+\])'
        matches = list(re.finditer(pattern, seal))
        assert len(matches) == 1, name
        match = matches[0]
        digest = bytes(json.loads(match[1]))
        assert len(digest) == 32
        seal = seal[:match.start(1)] + '[saved-caret-digest]' + seal[match.end(1):]
    return seal


def compare(actual, expected):
    assert set(actual) == set(expected)
    assert 'docInfo' in actual
    assert {k: v for k, v in actual.items() if k != 'docInfo'} == {
        k: v for k, v in expected.items() if k != 'docInfo'
    }, 'Difference outside DocInfo'
    a, ar, aseal = doc_info(actual['docInfo'])
    b, br, bseal = doc_info(expected['docInfo'])
    assert a == b, 'Typed DocInfo or other raw field differs'
    assert other_seals(aseal) == other_seals(bseal), 'Non-caret provenance seal changed'
    assert ar is not None and br is not None, 'Expected two HWP raw DocInfo streams'
    aa, bb = records(ar), records(br)
    assert len(aa) == len(bb)
    differences = []
    properties = 0
    for index, (ra, rb) in enumerate(zip(aa, bb)):
        assert ra[:3] == rb[:3], 'Raw record tag, level or header changed'
        tag, level, _, adata = ra
        bdata = rb[3]
        if tag == 16:
            properties += 1
            assert level == 0 and len(adata) == len(bdata) == 26
        if adata != bdata:
            assert tag == 16 and level == 0, 'Other raw record changed'
            assert adata[:14] == bdata[:14], 'Document counters changed'
            differences.append({'record': index, 'tag': tag,
                                'actualSavedCaret': list(struct.unpack('<3I', adata[14:])),
                                'expectedSavedCaret': list(struct.unpack('<3I', bdata[14:]))})
    assert properties == 1 and len(differences) == 1, 'Expected only one saved-caret difference'
    # Derived integrity seals are explicitly separated, never reported as exact.
    return {'caretDifferences': differences, 'rawRecordCount': len(aa),
            'allOtherRawRecordsExact': True, 'typedDocInfoExact': True,
            'paragraphsControlsBinDataExact': True, 'fullSvgExact': True,
            'allNonCaretRecordSealsExact': True,
            'actualRawDocInfoSHA256': sha(ar), 'expectedRawDocInfoSHA256': sha(br),
            'rawProvenanceExact': aseal == bseal,
            'actualRawProvenanceSHA256': sha((aseal or '').encode()),
            'expectedRawProvenanceSHA256': sha((bseal or '').encode())}


def refusal_checks(actual, expected):
    """Ensure the diagnostic exception cannot hide changes outside saved caret."""
    changes = {}
    changed = copy.deepcopy(actual)
    changed['paragraphs'] = ['unexpected paragraph/control/reference mutation']
    changes['paragraphsControlsReferences'] = changed
    changed = copy.deepcopy(actual)
    changed['docInfo'] = changed['docInfo'].replace('DocInfo { ', 'DocInfo { unexpected: 1, ', 1)
    changes['typedDocInfo'] = changed
    for label, offset in [('documentCounters', 4), ('otherRawRecord', 34)]:
        changed = copy.deepcopy(actual)
        start, end, raw = option_field(changed['docInfo'], 'raw_stream')
        raw = json.loads(raw)
        raw[offset] ^= 1
        changed['docInfo'] = changed['docInfo'][:start] + 'Some(' + json.dumps(raw) + ')' + changed['docInfo'][end:]
        changes[label] = changed
    changed = copy.deepcopy(actual)
    changed['docInfo'] = changed['docInfo'].replace('record_seals: DocInfoRecordSeals {',
                                                   'record_seals: UnexpectedRecordSeals {', 1)
    assert changed != actual
    changes['nonCaretProvenance'] = changed
    changed = copy.deepcopy(actual)
    start, end, _ = option_field(changed['docInfo'], 'raw_stream')
    _, _, raw = option_field(expected['docInfo'], 'raw_stream')
    changed['docInfo'] = changed['docInfo'][:start] + 'Some(' + raw + ')' + changed['docInfo'][end:]
    changes['provenanceOnlyWithoutCaretDifference'] = changed
    passed = []
    for label, changed in changes.items():
        try:
            compare(changed, expected)
        except AssertionError:
            passed.append(label)
        else:
            raise AssertionError('Exception accepted unexpected change: ' + label)
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=pathlib.Path, required=True)
    parser.add_argument('--manifest', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    native = args.native.resolve()
    rows = json.loads(args.manifest.read_text())
    # Refuse to overwrite any previous run or its strict-failure diagnostics.
    args.output.mkdir(parents=True, exist_ok=False)
    results, refusals = [], []
    for index, row in enumerate(rows):
        folder = args.output / f'{index:02d}'
        folder.mkdir()
        (folder / 'manifest.json').write_text(json.dumps([row], ensure_ascii=False, indent=2) + '\n')
        result = subprocess.run([str(native), 'verify', str(folder.resolve())],
                                capture_output=True, text=True, timeout=30)
        log = result.stdout + result.stderr
        (folder / 'native.log').write_text(log)
        proof = {'file': row['file'], 'input': row['input'], 'strictExitCode': result.returncode,
                 'nativeLogSHA256': sha(log.encode()), 'nativeOperationReexecution': True}
        if result.returncode == 0:
            proof['strictPassed'] = True
            proof['nativeProof'] = json.loads((folder / 'native-proof.json').read_text())
        else:
            assert result.returncode == 101 and 'bookmark_preservation_check.rs:738:' in log, log[:1000]
            assert 'assertion `left == right` failed: ' + row['file'] in log
            left = re.search(r'^\s*left: (Object .*)$', log, re.MULTILINE)
            right = re.search(r'^\s*right: (Object .*)$', log, re.MULTILINE)
            assert left and right, 'No canonical Value debug output'
            assert pathlib.Path(row['file']).suffix == '.hwp', 'No HWPX exception'
            actual, expected = ValueDebug(left[1]).parse(), ValueDebug(right[1]).parse()
            proof.update(strictPassed=False, boundedSavedCaretComparison=compare(actual, expected))
            if not refusals:
                refusals = refusal_checks(actual, expected)
        results.append(proof)
        print(json.dumps({'index': index, 'file': pathlib.Path(row['file']).name,
                          'strictPassed': proof['strictPassed']}, ensure_ascii=False), flush=True)
    proof = {'nativeExecutable': str(native), 'nativeSHA256': sha(native.read_bytes()),
             'manifestSHA256': sha(args.manifest.read_bytes()), 'independentSavedReopens': len(rows),
             'strictPasses': sum(r['strictPassed'] for r in results),
             'boundedSavedCaretComparisons': sum(not r['strictPassed'] for r in results),
             'boundedComparatorRefusalChecks': refusals,
             'documentsModified': False, 'rustRebuilt': False, 'checks': results}
    (args.output / 'proof.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in proof.items() if k != 'checks'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
