import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { MountHandle, MountOptions } from './app/types';
import './styles/base.css';

/**
 * The federated surface. Theme-passive by contract: the host owns the
 * document-level data-theme attribute and this function only forwards
 * opts.theme — only the standalone chrome wires an actual toggle.
 */
export function mount(el: HTMLElement, opts: MountOptions): MountHandle {
  const root = createRoot(el);
  root.render(<App {...opts} />);
  return {
    unmount: () => root.unmount(),
  };
}

// Script-tag fallback for hosts that load remoteEntry.js without a
// federation runtime — the previous widget exposed the same global.
if (typeof window !== 'undefined') {
  (window as unknown as { SvinoohAgentWidget?: { mount: typeof mount } }).SvinoohAgentWidget = {
    mount,
  };
}
