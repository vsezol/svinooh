import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  NO_THINKING,
  ROLE_PAIRS,
  REGISTRY,
  effectiveSettings,
  parseSettingsPatch,
  settingsView,
  type ModelFacts,
} from '../src/settings';

/**
 * A model id and a thinking setting are each valid on their own and can still
 * be a broken pair.
 *
 * This is the check bounds cannot make. `qwen/qwen3-30b-a3b-instruct-2507` is
 * spelled correctly and exists; "low" is one of the options. Together they took
 * the agent's classifier down for hours, because we tell the aggregator a
 * provider must support every parameter we send and no provider of an instruct
 * model supports reasoning — so every endpoint was filtered away.
 */

const CATALOGUE: ModelFacts[] = [
  { id: 'openai:deepseek/deepseek-v4-flash', thinks: true },
  { id: 'openai:qwen/qwen3-30b-a3b-instruct-2507', thinks: false },
];

const now = () => effectiveSettings([]);

const save = (patch: Record<string, unknown>, catalogue: ModelFacts[] = CATALOGUE) =>
  parseSettingsPatch(patch, now(), catalogue);

const problems = (result: ReturnType<typeof parseSettingsPatch>): string[] =>
  result.ok ? [] : result.problems;

describe('a model has to be able to do what the knob beside it asks', () => {
  test('a model that cannot reason is refused a thinking setting', () => {
    const result = save({
      'agent.routerModel': 'openai:qwen/qwen3-30b-a3b-instruct-2507',
      'agent.routerReasoningEffort': 'low',
    });
    assert.equal(result.ok, false);
    // Names the model and the value that fixes it — a refusal an operator can
    // act on without reading this file.
    const said = problems(result).join(' ');
    assert.match(said, /qwen3-30b-a3b-instruct-2507/);
    assert.match(said, new RegExp(NO_THINKING));
  });

  test('the same model is fine when it is asked for nothing', () => {
    const result = save({
      'agent.routerModel': 'openai:qwen/qwen3-30b-a3b-instruct-2507',
      'agent.routerReasoningEffort': NO_THINKING,
    });
    assert.equal(result.ok, true);
  });

  test('a model that reasons takes any setting', () => {
    const result = save({
      'agent.model': 'openai:deepseek/deepseek-v4-flash',
      'agent.reasoningEffort': 'high',
    });
    assert.equal(result.ok, true);
  });

  test('the knob already in force counts, not only the one being changed', () => {
    // Turning the effort up on a model saved earlier is the same mistake, and
    // the patch only carries the effort.
    const current = { ...now(), 'agent.routerModel': 'openai:qwen/qwen3-30b-a3b-instruct-2507' };
    const result = parseSettingsPatch({ 'agent.routerReasoningEffort': 'high' }, current, CATALOGUE);
    assert.equal(result.ok, false);
    assert.match(problems(result).join(' '), /qwen3-30b-a3b-instruct-2507/);
  });

  test('a model the catalogue does not list is not refused', () => {
    // Silence is not evidence. A model released this morning, or a private
    // endpoint, must not be unsettable because a third party has not caught up.
    const result = save({
      'agent.routerModel': 'openai:someone/brand-new',
      'agent.routerReasoningEffort': 'low',
    });
    assert.equal(result.ok, true);
  });

  test('no catalogue at all checks nothing', () => {
    // The aggregator being unreachable must never be why an operator cannot
    // change a setting in production.
    const result = save(
      {
        'agent.routerModel': 'openai:qwen/qwen3-30b-a3b-instruct-2507',
        'agent.routerReasoningEffort': 'low',
      },
      [],
    );
    assert.equal(result.ok, true);
  });

  test('an unset model is not judged — it runs on the answering one', () => {
    const result = save({ 'agent.routerModel': '', 'agent.routerReasoningEffort': 'high' });
    assert.equal(result.ok, true);
  });
});

describe('the pairing the panel is told about', () => {
  test('every pair names knobs that exist and are the right kind', () => {
    for (const { model, effort } of ROLE_PAIRS) {
      assert.equal(REGISTRY[model].kind, 'text', `${model} should name a model`);
      assert.equal(REGISTRY[effort].kind, 'choice', `${effort} should be a choice`);
    }
  });

  test('every thinking knob can be told to ask for nothing', () => {
    for (const { effort } of ROLE_PAIRS) {
      const spec = REGISTRY[effort];
      assert.ok(
        spec.kind === 'choice' && spec.options.includes(NO_THINKING),
        `${effort} has no way to send no reasoning parameter at all`,
      );
    }
  });

  test('a model knob carries its role to the browser, and a plain text knob does not', () => {
    const view = settingsView(now());
    const model = view.find((spec) => spec.key === 'agent.routerModel');
    assert.deepEqual(model?.role, {
      effort: 'agent.routerReasoningEffort',
      noThinking: NO_THINKING,
    });
    const notARole = view.find((spec) => spec.kind === 'text' && spec.key !== 'agent.model' && spec.key !== 'agent.routerModel');
    if (notARole) assert.equal(notARole.role, undefined);
  });
});
