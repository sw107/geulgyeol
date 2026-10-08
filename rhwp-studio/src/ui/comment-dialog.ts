import { ModalDialog } from './dialog';

/** Review text is separate from the immutable selected body text. */
export class CommentDialog extends ModalDialog {
  private contentInput!: HTMLTextAreaElement;
  private errorLabel!: HTMLDivElement;
  onApply: ((content: string) => void) | null = null;
  onRemove: (() => void) | null = null;

  constructor(private initial: {content: string; selectedText: string; editing: boolean;
    author: string; createDateTime: string | null; supportedSaveFormats: string[]}) {
    super(initial.editing ? '검토 주석 편집' : '검토 주석 추가', 460);
  }
  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'field-edit-body';
    const selected = document.createElement('p');
    selected.textContent = '본문 선택: ' + this.initial.selectedText;
    body.appendChild(selected);
    const label = document.createElement('label');
    label.className = 'field-edit-label'; label.textContent = '주석 내용';
    this.contentInput = document.createElement('textarea');
    this.contentInput.className = 'field-edit-input'; this.contentInput.rows = 5;
    this.contentInput.maxLength = 4096; this.contentInput.value = this.initial.content;
    label.appendChild(this.contentInput); body.appendChild(label);
    const metadata = document.createElement('p');
    metadata.textContent = this.initial.editing
      ? '작성자: ' + (this.initial.author || '(미지정)')
        + ' · 생성 시각: ' + (this.initial.createDateTime || '(표시 정보 없음)')
      : '새 주석의 작성자는 미지정이며 생성 시각은 기록하지 않습니다.';
    body.appendChild(metadata);
    const help = document.createElement('p');
    help.textContent = '내용 편집과 주석 삭제는 본문 선택 텍스트와 서식을 유지합니다.'
      + (this.initial.supportedSaveFormats.includes('hwp') ? ''
        : ' 이 문서는 기존 메타데이터 보존을 위해 HWPX로 저장해야 합니다.');
    body.appendChild(help);
    this.errorLabel = document.createElement('div');
    this.errorLabel.setAttribute('role', 'alert'); this.errorLabel.style.color = '#c00';
    body.appendChild(this.errorLabel);
    if (this.initial.editing) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'dialog-btn'; remove.textContent = '주석 삭제';
      remove.addEventListener('click', () => {
        try { this.onRemove?.(); this.hide(); }
        catch (error) { this.errorLabel.textContent = String(error); }
      });
      body.appendChild(remove);
    }
    return body;
  }
  protected onConfirm(): boolean {
    try {
      const content = this.contentInput.value;
      if (!content.trim() || content.length > 4096 || content.split('\n').length > 32
        || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\ud800-\udfff\ufffe\uffff]/u.test(content)) {
        throw new Error('주석 내용은 최대4096단위·32문단의 일반 텍스트로 입력하세요.');
      }
      this.onApply?.(content); return true;
    } catch (error) { this.errorLabel.textContent = String(error); return false; }
  }
}
