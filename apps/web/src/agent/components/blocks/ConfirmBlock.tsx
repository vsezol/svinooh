import type { ConfirmAddress, ConfirmBlock } from '../../app/types';

export type ConfirmAction = 'confirm' | 'cancel';

function AddressRow({ entry }: { entry: ConfirmAddress }) {
  return (
    <div className="sv-a-b-confirm-row">
      <span className="sv-a-b-confirm-address">{entry.address}</span>
      <span className="sv-a-b-confirm-chain">{entry.chain}</span>
      {entry.outcome === 'added' ? (
        <span className="sv-a-b-confirm-outcome" data-tone="up">
          added
        </span>
      ) : null}
      {entry.outcome === 'refused' ? (
        <span className="sv-a-b-confirm-outcome" data-tone="down">
          {entry.reason ?? 'refused'}
        </span>
      ) : null}
    </div>
  );
}

interface Props {
  block: ConfirmBlock;
  onAction?: (action: ConfirmAction) => void;
  busy?: boolean;
}

export default function ConfirmBlockView({ block, onAction, busy }: Props) {
  if (block.state === 'declined') {
    return (
      <div className="sv-a-b-card sv-a-b-confirm">
        <div className="sv-a-b-confirm-declined">Okay — nothing was created.</div>
      </div>
    );
  }

  const created = block.state === 'created';
  return (
    <div className="sv-a-b-card sv-a-b-confirm">
      <div className="sv-a-b-confirm-head">
        <div className="sv-a-b-eyebrow">{created ? 'CREATED' : 'PROPOSED ACTION'}</div>
        <div className="sv-a-b-confirm-title">
          {created ? block.portfolioName ?? block.title : block.title}
        </div>
      </div>
      <div className="sv-a-b-confirm-rows">
        {block.addresses.map((entry, i) => (
          <AddressRow key={i} entry={entry} />
        ))}
      </div>
      <div className="sv-a-b-confirm-foot" data-state={block.state}>
        {created ? (
          <>
            {block.summary ? <span className="sv-a-b-confirm-summary">{block.summary}</span> : null}
            {block.portfolioUrl ? (
              <a className="sv-a-b-confirm-link" href={block.portfolioUrl}>
                Open portfolio
              </a>
            ) : null}
          </>
        ) : (
          <>
            <div className="sv-a-b-confirm-note">Nothing is created yet.</div>
            <div className="sv-a-b-confirm-actions">
              <button
                type="button"
                className="ui-btn"
                data-variant="accent"
                data-size="md"
                disabled={busy}
                onClick={() => onAction?.('confirm')}
              >
                Create portfolio
              </button>
              <button
                type="button"
                className="ui-btn"
                data-variant="soft"
                data-size="md"
                onClick={() => onAction?.('cancel')}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
