// Temporary status writers share the displaced normal message. Retained print
// errors keep that target only while no external writer changes the element.
const ownedStatuses = new WeakMap<HTMLElement, PrintStatus>();

export class PrintStatus {
  private readonly originalStatus: string;
  private readonly observer: MutationObserver | null;
  private owned = true;
  private wrote = false;
  private failed = false;
  private finished = false;

  static hasRetainedFailure(element: HTMLElement): boolean {
    const owner = ownedStatuses.get(element);
    return !!(owner?.failed && owner.finished && owner.hasOwnership());
  }

  constructor(private readonly element: HTMLElement | null) {
    const previous = element ? ownedStatuses.get(element) : undefined;
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
    if (this.element && ownedStatuses.get(this.element) === this) {
      ownedStatuses.delete(this.element);
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
    ownedStatuses.set(this.element, this);
    return true;
  }

  fail(message: string): void {
    if (this.update(message)) this.failed = true;
  }

  finish(): void {
    if (this.finished) return;
    if (this.failed && this.element && this.hasOwnership()) {
      ownedStatuses.set(this.element, this);
      // Observe until another writer supersedes the failure or a retry starts.
    } else {
      if (this.wrote && this.hasOwnership()) this.update(this.originalStatus);
      this.release();
    }
    this.finished = true;
  }
}
