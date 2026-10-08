import { ModalDialog } from './dialog';

export interface ParagraphBandAppearance { height: number; fillBgColor: number }

/** Width and paragraph anchoring are fixed; the ordinary rectangle remains selectable. */
export class ParagraphBandDialog extends ModalDialog {
  private heightInput!: HTMLInputElement;
  private colorInput!: HTMLInputElement;
  private errorLabel!: HTMLDivElement;
  onApply: ((appearance: ParagraphBandAppearance) => void) | null = null;
  onRemove: (() => void) | null = null;

  constructor(private initial: ParagraphBandAppearance, private editing: boolean) {
    super(editing ? '문단 띠 편집' : '문단 띠 삽입', 380);
  }
  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    const help = document.createElement('p');
    help.textContent = '문단 너비100% · 문단 기준 · 선 없음'; body.appendChild(help);
    const thickness = document.createElement('label'); thickness.textContent = '두께(mm) ';
    this.heightInput = document.createElement('input'); this.heightInput.type = 'number';
    this.heightInput.min = '1'; this.heightInput.max = '20'; this.heightInput.step = '0.1';
    this.heightInput.value = this.initial.height === 283 ? '1' : String(Math.round(this.initial.height * 25.4 / 7200 * 1000) / 1000);
    thickness.appendChild(this.heightInput); body.appendChild(thickness);
    const color = document.createElement('label'); color.textContent = '면 색 ';
    this.colorInput = document.createElement('input'); this.colorInput.type = 'color';
    const rgb = ((this.initial.fillBgColor & 255) << 16) | (this.initial.fillBgColor & 0xff00) | ((this.initial.fillBgColor >>> 16) & 255);
    this.colorInput.value = '#' + rgb.toString(16).padStart(6, '0');
    color.appendChild(this.colorInput); body.appendChild(color);
    this.errorLabel = document.createElement('div'); this.errorLabel.setAttribute('role', 'alert');
    this.errorLabel.style.color = '#c00'; body.appendChild(this.errorLabel);
    if (this.editing) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'dialog-btn'; remove.textContent = '문단 띠 지우기';
      remove.addEventListener('click', () => { try { this.onRemove?.(); this.hide(); } catch (e) { this.errorLabel.textContent = String(e); } });
      body.appendChild(remove);
    }
    return body;
  }
  protected onConfirm(): boolean {
    try {
      const mm = Number(this.heightInput.value), hex = this.colorInput.value;
      // 283HU is the rounded default1mm; preserve it exactly on a no-op edit.
      const height = Math.round(mm / 25.4 * 7200);
      if (!this.heightInput.value.trim() || !Number.isFinite(mm) || mm < 1 || mm > 20 || height < 283 || height > 5669 || !/^#[\da-f]{6}$/i.test(hex)) {
        throw new Error('두께는1~20mm, 면 색은 유효한 색으로 지정하세요.');
      }
      const rgb = parseInt(hex.slice(1), 16), fillBgColor = ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 255);
      this.onApply?.({height, fillBgColor}); return true;
    } catch (e) { this.errorLabel.textContent = String(e); return false; }
  }
}
