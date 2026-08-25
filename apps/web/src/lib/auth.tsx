import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthConfigDto, AuthResponseDto, MeDto, TelegramAuthPayload } from '@svinooh/shared';
import { api, tokenStore } from './api';

interface AuthState {
  me: MeDto | null;
  config: AuthConfigDto | null;
  loading: boolean;
  loginTelegram: (payload: TelegramAuthPayload) => Promise<void>;
  loginDev: (name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  me: null,
  config: null,
  loading: true,
  loginTelegram: async () => {},
  loginDev: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDto | null>(null);
  const [config, setConfig] = useState<AuthConfigDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api<AuthConfigDto>('/auth/config'));
      } catch {
        // API лежит — страница всё равно отрисуется
      }
      if (tokenStore.get()) {
        try {
          setMe(await api<MeDto>('/auth/me'));
        } catch {
          tokenStore.clear();
        }
      }
      setLoading(false);
    })();
  }, []);

  const finish = useCallback((res: AuthResponseDto) => {
    tokenStore.set(res.token);
    setMe(res.me);
  }, []);

  const loginTelegram = useCallback(
    async (payload: TelegramAuthPayload) => {
      finish(await api<AuthResponseDto>('/auth/telegram', { method: 'POST', body: JSON.stringify(payload) }));
    },
    [finish],
  );

  const loginDev = useCallback(
    async (name: string) => {
      finish(await api<AuthResponseDto>('/auth/dev', { method: 'POST', body: JSON.stringify({ name }) }));
    },
    [finish],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, config, loading, loginTelegram, loginDev, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
