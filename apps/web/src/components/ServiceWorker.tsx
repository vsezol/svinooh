'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker — which is what makes the site installable, and
 * what makes an installed one open at once instead of waiting on the network
 * for assets it already has. Renders nothing.
 *
 * Only in production: in development the worker would sit in front of the dev
 * server and serve yesterday's chunks.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => {});
    // After load, so registering never competes with painting the page
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
