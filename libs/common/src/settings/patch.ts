import {
  NO_THINKING,
  REGISTRY,
  ROLE_PAIRS,
  RULES,
  type SettingKey,
  type SettingRule,
  type SettingSpec,
  type SettingValues,
  type SettingsPatch,
} from './registry';

/**
 * One model the panel may offer, and whether it can reason.
 *
 * Structural rather than imported from @svinooh/shared: this library is what
 * shared types are built from, and a check that needs to know what a model can
 * do should not turn that around.
 */
export interface ModelFacts {
  id: string;
  thinks: boolean;
}

/**
 * Turning what somebody submitted into a change the system will accept.
 *
 * One entry point: hand it an unknown body and the values in force, get back
 * either a typed patch or the reasons it cannot be one. Nothing downstream has
 * to check anything again — which is the point of doing it in one place rather
 * than at every call site that writes a row.
 *
 * There are two kinds of check here and only one of them could be a bound on a
 * field. A lease that expires before the scan it is leasing has finished is a
 * perfectly valid integer and a broken system; that is what RULES are for.
 */

export type PatchResult =
  | { ok: true; patch: SettingsPatch }
  | { ok: false; problems: string[] };

const isKey = (key: string): key is SettingKey => key in REGISTRY;

const known = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

/** One submitted value, checked against what its knob may be */
function read(spec: SettingSpec, raw: unknown): { value: number | string } | { problem: string } {
  if (spec.kind === 'choice') {
    const value = String(raw);
    return spec.options.includes(value)
      ? { value }
      : { problem: `${spec.label}: "${value}" is not one of ${spec.options.join(', ')}` };
  }

  if (spec.kind === 'text') {
    const value = String(raw ?? '').trim();
    if (value.length > spec.maxLength) {
      return { problem: `${spec.label}: longer than ${spec.maxLength} characters` };
    }
    // Empty is a legitimate value here: it means "fall back to what this knob
    // falls back to", which for the labelling model is the answering one.
    return { value };
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return { problem: `${spec.label}: "${String(raw)}" is not a number` };
  if (n < spec.min || n > spec.max) {
    const unit = spec.unit ? ` ${spec.unit}` : '';
    return { problem: `${spec.label}: ${n}${unit} is outside ${spec.min}–${spec.max}${unit}` };
  }
  return { value: Math.round(n) };
}

/**
 * Whether each role's model can do what its thinking setting asks of it.
 *
 * The check bounds cannot make and a list of allowed values cannot make either.
 * Every value involved is valid on its own: the model id exists and is spelled
 * correctly, the effort is one of the options. Only together are they wrong,
 * and only because of a fact about the model that its name does not carry.
 *
 * An instruct model has no thinking mode. Asking it for one is at best a
 * setting that does nothing, and it has already been worse than that: while we
 * demanded providers advertise every parameter we send, the ask was a filter
 * that emptied the routing list and failed every call. We no longer make that
 * demand, so this is a refusal about intent rather than about breakage — a
 * value whose only outcomes are nothing and harm is not one to save quietly.
 *
 * Without a catalogue there is nothing to check against and this passes. That
 * is deliberate: a third party being unreachable must not stop an operator
 * changing a setting.
 */
function thinkingFits(values: SettingValues, models: readonly ModelFacts[]): string[] {
  if (models.length === 0) return [];
  const thinks = new Map(models.map((model) => [model.id, model.thinks]));
  return ROLE_PAIRS.flatMap(({ model, effort }) => {
    const chosen = String(values[model] ?? '');
    // Unset means the role runs on the answering model, which this same loop
    // has already checked; unknown means the catalogue does not list it, and we
    // do not refuse a value on a catalogue's silence.
    if (!chosen || thinks.get(chosen) !== false) return [];
    if (values[effort] === NO_THINKING) return [];
    return [
      `${REGISTRY[effort].label}: ${chosen} has no thinking mode, so this has ` +
        `to be "${NO_THINKING}". Any other value asks it for something it does ` +
        `not have.`,
    ];
  });
}

/** Whether a rule still holds once the patch is applied */
function holds(rule: SettingRule, values: SettingValues): boolean {
  const left = values[rule.left] * rule.scale;
  const right = rule.atLeast.reduce((sum, key) => sum + values[key], 0);
  return left >= right;
}

export function parseSettingsPatch(
  input: unknown,
  current: SettingValues,
  models: readonly ModelFacts[] = [],
): PatchResult {
  const problems: string[] = [];
  const patch: Record<string, number | string> = {};

  for (const [key, raw] of Object.entries(known(input))) {
    if (!isKey(key)) {
      problems.push(`${key}: not a setting`);
      continue;
    }
    const result = read(REGISTRY[key], raw);
    if ('problem' in result) problems.push(result.problem);
    else patch[key] = result.value;
  }

  // Rules weigh the system as it would actually be, so a knob nobody touched
  // still counts — which is why `current` is a parameter and not a lookup
  if (problems.length === 0) {
    const next = { ...current, ...patch } as SettingValues;
    problems.push(...RULES.filter((rule) => !holds(rule, next)).map((rule) => rule.about));
    problems.push(...thinkingFits(next, models));
  }

  return problems.length ? { ok: false, problems } : { ok: true, patch: patch as SettingsPatch };
}
