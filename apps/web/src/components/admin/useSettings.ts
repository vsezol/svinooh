'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelChoiceDto, SettingDto, SettingsDto, UpdateSettingsDto } from '@svinooh/shared';
import { api, ApiError } from '../../lib/api';

/**
 * Loading the knobs, holding what has been typed, and saving the difference.
 *
 * All of the panel's state is here so the components below are only rendering:
 * a row does not know what a request is, and this does not know what a row
 * looks like.
 */
export interface SettingsForm {
  specs: SettingDto[] | null;
  /**
   * What the model fields may be set to. Empty when the catalogue could not be
   * read, and those fields fall back to being typed by hand.
   */
  models: ModelChoiceDto[];
  /** What is in the inputs, as text — the value the browser actually holds */
  draft: Record<string, string>;
  /** Only what differs from what the server returned, which is what gets sent */
  changed: Record<string, string>;
  problems: string[];
  saved: boolean;
  busy: boolean;
  /** The api answered 404, which is what a non-admin gets */
  denied: boolean;
  set: (key: string, value: string) => void;
  save: () => void;
}

export function useSettings(): SettingsForm {
  const [specs, setSpecs] = useState<SettingDto[] | null>(null);
  const [models, setModels] = useState<ModelChoiceDto[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback((data: SettingsDto) => {
    setSpecs(data.settings);
    setModels(data.models ?? []);
    setDraft(Object.fromEntries(data.settings.map((s) => [s.key, String(s.value)])));
  }, []);

  useEffect(() => {
    void api<SettingsDto>('/admin/settings')
      .then(load)
      .catch((err) => setDenied(err instanceof ApiError && err.statusCode === 404));
  }, [load]);

  /**
   * The server treats the payload as a patch, so only what was touched goes.
   * Sending everything would make a rule complain about a number nobody changed
   * the moment a default moves.
   */
  const changed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const spec of specs ?? []) {
      if (draft[spec.key] !== undefined && draft[spec.key] !== String(spec.value)) {
        out[spec.key] = draft[spec.key];
      }
    }
    return out;
  }, [specs, draft]);

  const set = useCallback((key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const save = useCallback(() => {
    void (async () => {
      setBusy(true);
      setProblems([]);
      setSaved(false);
      try {
        const patch: UpdateSettingsDto = changed;
        load(await api<SettingsDto>('/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }));
        setSaved(true);
      } catch (err) {
        // The service answers with one message per problem; the api joins them
        setProblems(err instanceof ApiError ? err.message.split(', ') : ['Could not save']);
      } finally {
        setBusy(false);
      }
    })();
  }, [changed, load]);

  return { specs, models, draft, changed, problems, saved, busy, denied, set, save };
}
