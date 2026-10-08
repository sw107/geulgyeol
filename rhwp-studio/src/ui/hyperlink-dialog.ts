import { ModalDialog } from './dialog';

/** Author data only: this dialog never follows or opens a URL. */
export class HyperlinkDialog extends ModalDialog {
  private urlInput!: HTMLInputElement;
  private textInput!: HTMLInputElement;
  private errorLabel!: HTMLDivElement;
  onApply: ((url: string, display: string) => void) | null = null;
  onRemove: (() => void) | null = null;

  constructor(private initial: {url: string; text: string; keepText: boolean; editing: boolean}) {
    super(initial.editing ? '하이퍼링크 편집' : '하이퍼링크 삽입', 440);
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'field-edit-body';
    const label = (text: string) => {
      const el = document.createElement('label');
      el.textContent = text;
      el.className = 'field-edit-label';
      body.appendChild(el);
      return el;
    };
    const textLabel = label('표시 문구');
    this.textInput = document.createElement('input');
    this.textInput.type = 'text';
    this.textInput.className = 'field-edit-input';
    this.textInput.maxLength = 4096;
    this.textInput.value = this.initial.text;
    this.textInput.readOnly = this.initial.keepText;
    textLabel.appendChild(this.textInput);
    const urlLabel = label('URL (http:// 또는 https://)');
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.className = 'field-edit-input';
    this.urlInput.maxLength = 4096;
    this.urlInput.value = this.initial.url;
    urlLabel.appendChild(this.urlInput);
    const help = document.createElement('p');
    help.textContent = this.initial.keepText
      ? '표시 텍스트와 서식은 유지됩니다. 링크 해제도 텍스트를 지우지 않습니다.'
      : '표시 문구가 비어 있으면 URL을 표시합니다.';
    body.appendChild(help);
    this.errorLabel = document.createElement('div');
    this.errorLabel.setAttribute('role', 'alert');
    this.errorLabel.style.color = '#c00';
    body.appendChild(this.errorLabel);
    if (this.initial.editing) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'dialog-btn';
      remove.textContent = '링크 해제';
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
      const url = this.urlInput.value;
      const parsed = new URL(url);
      if (!/^https?:\/\//i.test(url) || !['http:', 'https:'].includes(parsed.protocol)
        || !parsed.hostname || parsed.username || parsed.password || url.length > 4096
        || /[\s\u0000-\u001f\u007f<>"\\]/u.test(url)) {
        throw new Error('명시적인 http:// 또는 https:// URL을 입력하세요.');
      }
      const display = this.textInput.value || url;
      if (!this.initial.keepText && (display.length > 4096 || /[\u0000-\u001f\u007f]/u.test(display))) {
        throw new Error('표시 문구는 한 문단의 일반 텍스트로 입력하세요.');
      }
      this.onApply?.(url, display);
      return true;
    } catch (error) {
      this.errorLabel.textContent = String(error);
      return false;
    }
  }
}
