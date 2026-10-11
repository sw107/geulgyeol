import {
  exportDocumentWithReportForFormat,
  exportPasswordProtectedDocumentWithReportForFormat,
  type ReportedDocumentFormatPasswordExporter,
  type SaveExportArtifact,
} from './save-document-format.ts';

interface HostSaveExporter extends ReportedDocumentFormatPasswordExporter {
  readonly requiresPasswordForSave: boolean;
  readonly fileName: string;
}

function checkedBytes(artifact: SaveExportArtifact): Uint8Array {
  if (!artifact.contentLoss || artifact.contentLoss.count !== 0) {
    throw new Error('저장 시 일부 내용을 보존할 수 없어 중단했습니다.');
  }
  return artifact.bytes;
}

/** Explicit local save only. Passwords stay inside the renderer, for one call. */
export async function exportHostDocumentForSave(
  exporter: HostSaveExporter,
  format: string,
  assertCurrent: () => void,
  choosePassword: (fileName: string) => Promise<string | null>,
): Promise<Uint8Array | null> {
  if (format !== 'hwp' && format !== 'hwpx') {
    throw new Error('HWP 또는 HWPX 형식을 선택하세요.');
  }
  assertCurrent();
  if (!exporter.requiresPasswordForSave) {
    return checkedBytes(exportDocumentWithReportForFormat(exporter, format));
  }

  let password: string | null = null;
  try {
    try { password = await choosePassword(exporter.fileName); }
    catch { throw new Error('저장 암호 입력을 완료하지 못했습니다. 다시 시도하세요.'); }
    if (password === null) return null;
    assertCurrent();
    if (password.length < 5) throw new Error('저장 암호는 5자 이상으로 입력하세요.');
    let artifact: SaveExportArtifact;
    try {
      artifact = exportPasswordProtectedDocumentWithReportForFormat(exporter, format, password);
    } catch {
      // Never expose a password-bearing exception or fall back to plaintext.
      throw new Error('암호화 저장 데이터를 만들지 못했습니다. 문서와 저장 형식을 확인하세요.');
    }
    return checkedBytes(artifact);
  } finally {
    password = '';
  }
}
