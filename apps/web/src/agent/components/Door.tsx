import { AgentIntro } from './AgentIntro';

interface Props {
  onSignIn: (provider: 'telegram' | 'x') => void;
}

/**
 * The same opening, for somebody who has not signed in.
 *
 * The intro is the intro — a visitor and an account holder are looking at the
 * same product, and telling the visitor about it differently was how the two
 * screens drifted. What is added is the way in, and only that: the feature
 * list and the paragraph about which answers need an account are gone, because
 * the composer below is enabled and answering a DeFi question demonstrates
 * both faster than a bullet does.
 */
export function Door({ onSignIn }: Props) {
  return (
    <div className="sv-a-c-door">
      <AgentIntro />
      <div className="sv-a-c-door-ctas">
        <button type="button" className="ui-btn" data-variant="accent" data-size="lg" data-block="true" onClick={() => onSignIn('telegram')}>
          Continue with Telegram
        </button>
        <button type="button" className="ui-btn" data-variant="soft" data-size="lg" data-block="true" onClick={() => onSignIn('x')}>
          Continue with X
        </button>
      </div>
    </div>
  );
}
