// A retained print error remembers the message it displaced, but only while
// no other writer has changed that status element (including identical text).
const failedStatuses = new WeakMap<HTMLElement, PrintStatus>();

export class PrintStatus {
  private readonly originalStatus: string;
  private readonly observer: MutationObserver | null;
  private owned = true;
  private wrote = false;
  private failed = false;
  private finished = false;

  constructor(private readonly element: HTMLElement | null) {
    const previous = element ? failedStatuses.get(element) : undefined;
    this.originalStatus = previous?.hasOwnership()
      ? previous.originalStatus : element?.textContent ?? '';
    previous?.release();
    this.observer = element ? new MutationObserver(records => {
      if (records.length) this.release();
    }) : null;
    this.observer?.observe(element!, {
      childList: true, characterData: true, subtree: true,
    });
  }

  private release(): void {
    this.owned = false;
    this.observer?.disconnect();
    if (this.element && failedStatuses.get(this.element) === this) {
      failedStatuses.delete(this.element);
    }
  }

  private hasOwnership(): boolean {
    // A newer write may still be queued for the observer's microtask. Drain it
    // before changing the text so even same-turn/identical writes are preserved.
    if (this.observer?.takeRecords().length) this.release();
    return this.owned;
  }

  update(message: string): boolean {
    if (this.finished || !this.element || !this.hasOwnership()) return false;
    this.element.textContent = message;
    // These records are exclusively our synchronous write. External records
    // were consumed above; later external mutations relinquish ownership.
    this.observer?.takeRecords();
    this.wrote = true;
    return true;
  }

  fail(message: string): void {
    if (this.update(message)) this.failed = true;
  }

  finish(): void {
    if (this.finished) return;
    if (this.failed && this.element && this.hasOwnership()) {
      failedStatuses.set(this.element, this);
      // Observe until another writer supersedes the failure or a retry starts.
    } else {
      if (this.wrote && this.hasOwnership()) this.update(this.originalStatus);
      this.release();
    }
    this.finished = true;
  }
}
