import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthConfigDto, AuthResponseDto, MeDto, TelegramAuthPayload } from '@svinooh/shared';
import { api, tokenStore } from './api';
import { settleClaim } from './claim';

interface AuthState {
  me: MeDto | null;
  config: AuthConfigDto | null;
  loading: boolean;
  loginTelegram: (payload: TelegramAuthPayload) => Promise<MeDto>;
  loginDev: (name: string) => Promise<MeDto>;
  /** Apply a ready-made auth response (e.g. from bot polling) */
  applyAuth: (res: AuthResponseDto) => Promise<MeDto>;
  /** Re-ask the server who we are — after something changed what we own */
  refreshMe: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  me: null,
  config: null,
  loading: true,
  loginTelegram: async () => ({}) as MeDto,
  loginDev: async () => ({}) as MeDto,
  applyAuth: async () => ({}) as MeDto,
  refreshMe: async () => {},
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
        // API is down — the page still renders anyway
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

  /**
   * The single funnel every successful sign-in passes through — widget, bot or
   * dev login. A portfolio the visitor set out to claim is taken over here, so
   * whatever navigates afterwards follows them to it.
   */
  const finish = useCallback(async (res: AuthResponseDto): Promise<MeDto> => {
    tokenStore.set(res.token);
    const settled = await settleClaim(res.me);
    setMe(settled);
    return settled;
  }, []);

  const loginTelegram = useCallback(
    async (payload: TelegramAuthPayload) =>
      finish(await api<AuthResponseDto>('/auth/telegram', { method: 'POST', body: JSON.stringify(payload) })),
    [finish],
  );

  const loginDev = useCallback(
    async (name: string) =>
      finish(await api<AuthResponseDto>('/auth/dev', { method: 'POST', body: JSON.stringify({ name }) })),
    [finish],
  );

  const refreshMe = useCallback(async () => {
    if (!tokenStore.get()) return;
    try {
      setMe(await api<MeDto>('/auth/me'));
    } catch {
      // an expired session is discovered by the next real request, not here
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, config, loading, loginTelegram, loginDev, applyAuth: finish, refreshMe, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
