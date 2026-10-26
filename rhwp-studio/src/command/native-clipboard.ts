/** The same-origin desktop parent owns the trusted native clipboard bridge. */
export function readNativeClipboardText(): string | null {
  try {
    const text = (window.parent as any).baram?.clipboardText?.();
    return typeof text === 'string' ? text : null;
  } catch { return null; }
}
