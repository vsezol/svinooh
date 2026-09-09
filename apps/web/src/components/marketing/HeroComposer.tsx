'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallClock } from '../../lib/clock';
import { DEMO_AT_REST, SCENES, demoFrame, parts, type DemoScene, type StepState } from '../../lib/hero-demo';

/**
 * The front door: a real composer with the product demonstrating itself
 * underneath.
 *
 * The field is not a mock-up. Whatever is typed here is the first message of a
 * real conversation, and pressing send hands it to the chat — see the landing's
 * `send`. Until somebody types, the field types a question to itself and the
 * panel below answers it: a trace of the tool calls, then the answer with the
 * block that belongs to it.
 *
 * Two rules hold the panel still. It never empties — while the next question
 * is being typed the previous answer is still there, dimmed — and it never
 * changes height, because a card that grows and shrinks under a field somebody
 * is trying to type in is a card that moves the field.
 */

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const MONO_IN_TEXT = {
  fontFamily: 'var(--mono)',
  fontSize: 'var(--fs-body)',
  fontWeight: 'var(--fw-medium)',
} as const;

/** The mark at the head of a trace line: done, running, or not started. */
function StepMark({ state }: { state: StepState }) {
  return (
    <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {state === 'done' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      ) : state === 'running' ? (
        <span
          style={{
            width: 11,
            height: 11,
            border: '1.5px solid var(--line2)',
            borderTopColor: 'var(--acc)',
            borderRadius: '50%',
            animation: 'svspin .8s linear infinite',
          }}
        />
      ) : (
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--line2)' }} />
      )}
    </span>
  );
}

/** The card that comes with an answer — at most one per scene. */
function DemoBlock({ scene }: { scene: DemoScene }) {
  if (scene.cards) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(112px,1fr))', gap: 8 }}>
        {scene.cards.map((card) => (
          <div
            key={card.label}
            style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surf2)', padding: '11px 13px', minWidth: 0 }}
          >
            <div className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.label}
            </div>
            <div className="mono" style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-title)', marginTop: 5, whiteSpace: 'nowrap' }}>
              {card.value}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 'var(--fs-tag)',
                marginTop: 4,
                whiteSpace: 'nowrap',
                color: card.tone === 'up' ? 'var(--up)' : card.tone === 'down' ? 'var(--down)' : 'var(--mut)',
              }}
            >
              {card.delta}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (scene.range) {
    return (
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surf2)', padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)' }}>Orca · SOL/USDC</span>
          <span className="mono" style={{ fontSize: 'var(--fs-micro)', letterSpacing: 'var(--tr-tag)', color: 'var(--down)' }}>
            OUT OF RANGE
          </span>
        </div>
        {/* Where the pool's range sits, and where the price has got to. */}
        <div style={{ position: 'relative', height: 4, borderRadius: 'var(--r-full)', background: 'var(--line2)', margin: '14px 0 9px' }}>
          <div style={{ position: 'absolute', left: '22%', right: '16%', top: 0, bottom: 0, borderRadius: 'var(--r-full)', background: 'color-mix(in srgb, var(--acc) 55%, transparent)' }} />
          <div style={{ position: 'absolute', left: '88%', top: -4, width: 3, height: 12, borderRadius: 2, background: 'var(--down)' }} />
        </div>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-tag)', color: 'var(--mut)' }}>
          <span>$142.00</span>
          <span style={{ color: 'var(--down)' }}>$214.60 now</span>
          <span>$196.00</span>
        </div>
      </div>
    );
  }

  if (!scene.action) return null;

  return (
    <div style={{ border: '1px solid var(--line2)', borderRadius: 'var(--r-lg)', background: 'var(--surf2)', overflow: 'hidden' }}>
      <div style={{ padding: '13px 15px 11px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}>
            PROPOSED TRANSACTION
          </div>
          <div style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-read)', letterSpacing: 'var(--tr-tight)', marginTop: 5 }}>
            Supply 4,200 USDC to Aave V3
          </div>
        </div>
        <span className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-tag)', color: 'var(--mut)', border: '1px solid var(--line2)', borderRadius: 'var(--r-full)', padding: '4px 8px', whiteSpace: 'nowrap' }}>
          ARBITRUM
        </span>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--line)' }}>
        {[
          { label: 'SUPPLY APY', value: '6.8%' },
          { label: 'WITHDRAW', value: 'Any time' },
        ].map((cell, i) => (
          <div key={cell.label} style={{ flex: 1, padding: '10px 15px', borderLeft: i ? '1px solid var(--line)' : undefined }}>
            <div className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}>
              {cell.label}
            </div>
            <div className="mono" style={{ fontSize: 'var(--fs-control)', fontWeight: 'var(--fw-medium)', marginTop: 4 }}>
              {cell.value}
            </div>
          </div>
        ))}
      </div>
      {/* Signing is what the agent is growing towards and is not wired yet, so
          the card says so rather than offering a button that does nothing. */}
      <div style={{ borderTop: '1px solid var(--line)', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ height: 36, padding: '0 15px', borderRadius: 'var(--r-full)', background: 'var(--acc)', color: 'var(--acc-ink)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-control)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" {...ICON} strokeWidth={2} aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h13v4" />
            <path d="M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z" />
          </svg>
          Confirm in wallet
        </div>
        <span className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--acc-text)', background: 'var(--acc-soft)', borderRadius: 'var(--r-full)', padding: '4px 8px' }}>
          SOON
        </span>
      </div>
    </div>
  );
}

export interface HeroComposerHandle {
  /** Bring the composer into view and put the caret in it. */
  focus(): void;
}

interface Props {
  onSend: (text: string) => void;
  /** Filled in so the page's closing CTA can reach back up to the field. */
  handle?: { current: HeroComposerHandle | null };
}

export function HeroComposer({ onSend, handle }: Props) {
  const clock = useWallClock();
  const t = clock ?? DEMO_AT_REST;
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  /** A pressed example, and when it was pressed. */
  const [pick, setPick] = useState<{ index: number; at: number } | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      focus: () => {
        card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.current?.focus();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  const frame = demoFrame(t, pick);
  // The ghost is the demo speaking through the field, so it goes the moment
  // the field is somebody else's — focused, or with anything in it.
  const ghost = !focused && !text;
  const send = () => {
    const question = text.trim();
    if (question) onSend(question);
  };

  return (
    <div style={{ maxWidth: 640, width: '100%', margin: '0 auto', padding: 'clamp(22px,3.5vw,34px) clamp(14px,3.5vw,28px) 0' }}>
      <div
        ref={card}
        style={{
          border: '1px solid var(--line2)',
          borderRadius: 26,
          background: 'var(--surf)',
          // The one glow on the page, under the one thing it is asking you to
          // use. Accent-tinted rather than black: a shadow that colour would
          // read as depth, and this is meant to read as attention.
          boxShadow: '0 40px 90px -50px color-mix(in srgb, var(--acc) 40%, transparent)',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', padding: '9px 9px 9px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
          {ghost ? (
            <div
              aria-hidden="true"
              style={{ position: 'absolute', left: 18, right: 60, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-lead)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{frame.typed}</span>
              <span style={{ width: 2, height: 18, background: 'var(--acc)', marginLeft: 2, flexShrink: 0, animation: 'svcaret 1s steps(1) infinite' }} />
            </div>
          ) : null}
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // Nothing while the ghost is typing — two lots of grey text in one
            // field is neither a placeholder nor a demo.
            placeholder={ghost ? '' : 'Paste a wallet address or ask anything…'}
            aria-label="Ask the agent"
            spellCheck={false}
            autoComplete="off"
            style={{ flex: 1, minWidth: 0, height: 38, background: 'transparent', border: 'none', outline: 'none', fontSize: 'var(--fs-lead)', color: 'var(--text)', padding: 0 }}
          />
          <button
            type="button"
            onClick={send}
            aria-label="Send"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: 0,
              // Lit only when there is something to send: the button is the
              // page's one call to action and it earns that by being off until
              // it has a job.
              background: text ? 'var(--acc)' : 'var(--surf2)',
              color: text ? 'var(--acc-ink)' : 'var(--mut)',
              border: `1px solid ${text ? 'var(--acc)' : 'var(--line2)'}`,
              transition: 'background var(--ease-settle), color var(--ease-settle)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" {...ICON} aria-hidden="true">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>

        {/* The demo's answer. A fixed floor under it, because this is the panel
            directly under the field: a height that follows the content would
            move the field between scenes. */}
        <div style={{ padding: '16px 18px 18px', textAlign: 'left', minHeight: 186 }} aria-live="off">
          {frame.working ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {frame.steps.map((step) => (
                <div
                  key={step.label}
                  className="mono"
                  style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 'var(--fs-step)', color: step.state === 'waiting' ? 'var(--mut)' : 'var(--text)' }}
                >
                  <StepMark state={step.state} />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                // Dimmed on the way out, and it arrives rather than appears.
                // The animation is off while it is leaving so the fade-in does
                // not fight the fade-out.
                opacity: frame.fading ? 0.3 : 1,
                animation: frame.fading ? 'none' : 'svin .35s ease both',
                transition: 'opacity .4s ease',
              }}
            >
              <div style={{ fontSize: 'var(--fs-read)', lineHeight: 1.6, textWrap: 'pretty' }}>
                {parts(frame.shown.answer).map((part, i) => (
                  <span key={i} style={part.mono ? MONO_IN_TEXT : undefined}>
                    {part.text}
                  </span>
                ))}
              </div>
              <DemoBlock scene={frame.shown} />
            </div>
          )}
        </div>

        {/* Three real questions. Pressing one plays its scene rather than
            sending it — the field is right above, and somebody who wants to
            ask it can. */}
        <div className="sv-l-chips" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--line)', background: 'var(--surf2)' }}>
          <span className="mono" style={{ fontSize: 'var(--fs-eyebrow)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)', padding: '0 4px 0 2px', flexShrink: 0 }}>
            TRY
          </span>
          {SCENES.map((scene, i) => (
            <button
              key={scene.q}
              type="button"
              onClick={() => setPick({ index: i, at: t })}
              className="mono"
              style={{
                fontSize: 'var(--fs-tag)',
                padding: '6px 11px',
                borderRadius: 'var(--r-full)',
                border: `1px solid ${i === frame.index ? 'var(--mut)' : 'var(--line2)'}`,
                background: i === frame.index ? 'var(--surf)' : 'transparent',
                color: i === frame.index ? 'var(--text)' : 'var(--mut)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'color var(--ease-settle), border-color var(--ease-settle)',
              }}
            >
              {scene.q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
