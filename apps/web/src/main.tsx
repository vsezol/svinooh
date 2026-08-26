import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { TelegramResume } from './components/TelegramResume';
import { Landing } from './pages/Landing';
import { PortfolioPage } from './pages/PortfolioPage';
import { preloadedLanding } from './lib/landing-data';
import './styles.css';

const root = document.getElementById('root')!;

const app = (
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TelegramResume />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/p/:slug" element={<PortfolioPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);

// The landing arrives already rendered — attach to that markup instead of
// throwing it away and painting the page a second time. Every other route is
// served as an empty shell, so there is nothing to hydrate.
if (preloadedLanding()) hydrateRoot(root, app);
else createRoot(root).render(app);
