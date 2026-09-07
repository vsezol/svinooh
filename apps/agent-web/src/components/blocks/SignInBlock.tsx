import type { SignInBlock } from '../../app/types';

export type SignInProvider = 'telegram' | 'x';

function TelegramIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

interface Props {
  block: SignInBlock;
  onSignIn?: (provider: SignInProvider) => void;
}

export default function SignInBlockView({ block, onSignIn }: Props) {
  return (
    <div className="sv-a-b-card sv-a-b-signin">
      <div className="sv-a-b-signin-title">{block.title}</div>
      <div className="sv-a-b-signin-sub">{block.sub}</div>
      <div className="sv-a-b-signin-actions">
        <button
          type="button"
          className="ui-btn"
          data-variant="accent"
          data-size="md"
          onClick={() => onSignIn?.('telegram')}
        >
          <TelegramIcon />
          Continue with Telegram
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="soft"
          data-size="md"
          onClick={() => onSignIn?.('x')}
        >
          <XIcon />
          Continue with X
        </button>
      </div>
      {block.pendingQuestion ? (
        <div className="sv-a-b-signin-pending">
          {`AFTER SIGN-IN I'LL ANSWER · "${block.pendingQuestion}"`}
        </div>
      ) : null}
    </div>
  );
}
