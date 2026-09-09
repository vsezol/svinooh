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
  // The actions a host's own navigation needs. They cannot be returned
  // directly — the component does not exist until React has rendered, which is
  // after this function returns — so a box is handed in, filled on the first
  // render, and read through the handle.
  const control = {
    newChat: () => undefined,
    openConversation: (_id: string) => undefined,
    openHistory: () => undefined,
  };
  root.render(<App {...opts} control={control} />);
  return {
    unmount: () => root.unmount(),
    newChat: () => control.newChat(),
    openConversation: (id: string) => control.openConversation(id),
    openHistory: () => control.openHistory(),
  };
}

// Script-tag fallback for hosts that load remoteEntry.js without a
// federation runtime — the previous widget exposed the same global.
if (typeof window !== 'undefined') {
  (window as unknown as { SvinoohAgentWidget?: { mount: typeof mount } }).SvinoohAgentWidget = {
    mount,
  };
}
