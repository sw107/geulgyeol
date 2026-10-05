import type { CommandRegistry } from './registry';

export type HostFileAction = 'open' | 'new' | 'save' | 'save-hwp' | 'save-hwpx';

// Preserve command availability and dispatcher loading/form guards. The host
// owns native dialogs, dirty confirmation, export validation and clean state.
export function installHostFileActions(registry: CommandRegistry, dispatch: (action: HostFileAction) => void): void {
  const routes: Record<string, HostFileAction> = {
    'file:open': 'open', 'file:new-doc': 'new', 'file:save': 'save',
    'file:save-as': 'save', 'file:save-as-hwp': 'save-hwp', 'file:save-as-hwpx': 'save-hwpx',
  };
  for (const [id, action] of Object.entries(routes)) {
    const original = registry.get(id);
    if (original) registry.register({ ...original, execute: () => dispatch(action) });
  }
}
