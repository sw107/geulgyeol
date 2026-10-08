/** Close approval keeps every supported document handle read-only until cancellation. */
export class DocumentWriteFence {
  private locked = false;

  get isLocked(): boolean { return this.locked; }
  lock(): void { this.locked = true; }
  unlock(): void { this.locked = false; }

  assertWritable(): void {
    if (this.locked) throw new Error('문서를 닫는 중에는 편집할 수 없습니다.');
  }

  guard<T extends object>(document: T): T {
    const methods = new Map<PropertyKey, unknown>();
    return new Proxy(document, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function' || key === 'constructor') return value;
        if (!methods.has(key)) {
          // Unknown operations are refused too. Getters and exports retain their
          // read contract; export's internal saved metadata is not a user edit.
          const readOnly = typeof key === 'string' && /^(get|export|render|is|has)/.test(key);
          methods.set(key, (...args: unknown[]) => {
            if (!readOnly) this.assertWritable();
            return Reflect.apply(value, target, args);
          });
        }
        return methods.get(key);
      },
      set: (target, key, value) => {
        this.assertWritable();
        return Reflect.set(target, key, value, target);
      },
    });
  }
}
