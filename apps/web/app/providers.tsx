'use client';

import type { ReactNode } from 'react';
import { PaywallProvider } from '../src/components/Paywall';
import { ServiceWorker } from '../src/components/ServiceWorker';
import { TelegramResume } from '../src/components/TelegramResume';
import { AuthProvider } from '../src/lib/auth';
import { ThemeProvider } from '../src/lib/theme';

/** Everything the whole app sits inside — and the boundary where it becomes a client tree */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PaywallProvider>
          <ServiceWorker />
          <TelegramResume />
          {children}
        </PaywallProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
