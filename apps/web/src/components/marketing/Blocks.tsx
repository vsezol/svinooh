// Straight from the module, not the barrel — see Shell.tsx
import { ButtonLink } from '../../ui/Button';

/**
 * The building blocks of a marketing page, shaped for how these pages are
 * actually read: an engine lifts the first paragraph, a table, and a Q&A —
 * so the intro leads with the direct answer, the table is a real <table>,
 * and the FAQ carries its own schema.org transcript.
 */

/** Eyebrow, h1, and the direct answer up front — the paragraph an engine lifts. */
export function PageIntro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: React.ReactNode }) {
  return (
    <header style={{ marginBottom: 36 }}>
      <p className="mono" style={{ margin: 0, fontSize: 'var(--fs-micro)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}>
        {eyebrow}
      </p>
      <h1
        style={{
          margin: '10px 0 0',
          fontWeight: 'var(--fw-heavy)',
          fontSize: 'clamp(26px,4.5vw,40px)',
          letterSpacing: '-0.03em',
          lineHeight: 1.12,
          textWrap: 'balance',
        }}
      >
        {title}
      </h1>
      <p style={{ margin: '16px 0 0', fontSize: 'var(--fs-lead)', lineHeight: 1.7, color: 'var(--mut)', textWrap: 'pretty' }}>
        {lead}
      </p>
    </header>
  );
}

export function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 40, scrollMarginTop: 70 }}>
      <h2 style={{ margin: 0, fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-display)', letterSpacing: 'var(--tr-tight)' }}>
        {title}
      </h2>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 'var(--fs-lead)', lineHeight: 1.7, textWrap: 'pretty' }}>{children}</p>;
}

const CELL = { padding: '11px 16px', textAlign: 'left' as const, verticalAlign: 'top' as const };
const HEAD = {
  ...CELL,
  fontSize: 'var(--fs-micro)',
  letterSpacing: '0.12em',
  fontWeight: 'var(--fw-normal)',
};

/** A real table, because engines quote tables and screen readers walk them. */
export function CompareTable({
  other,
  rows,
}: {
  other: string;
  rows: { label: string; ours: string; theirs: string }[];
}) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 18 }}>
      <div style={{ minWidth: 540, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surf)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead className="mono">
            <tr>
              <th style={HEAD} scope="col" aria-label="Feature" />
              <th style={{ ...HEAD, color: 'var(--acc-text)' }} scope="col">
                SVINOOH
              </th>
              <th style={{ ...HEAD, color: 'var(--mut)' }} scope="col">
                {other.toUpperCase()}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th
                  scope="row"
                  className="mono"
                  style={{
                    ...CELL,
                    borderTop: '1px solid var(--line)',
                    fontSize: 'var(--fs-micro)',
                    letterSpacing: '0.08em',
                    color: 'var(--mut)',
                    fontWeight: 'var(--fw-normal)',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.label}
                </th>
                <td style={{ ...CELL, borderTop: '1px solid var(--line)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)' }}>
                  {r.ours}
                </td>
                <td style={{ ...CELL, borderTop: '1px solid var(--line)', fontSize: 'var(--fs-body)', color: 'var(--mut)' }}>
                  {r.theirs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The small print under a table of claims about somebody else's product. */
export function CheckedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono" style={{ margin: '12px 0 0', fontSize: 'var(--fs-micro)', letterSpacing: '0.04em', color: 'var(--mut)', lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

/**
 * Questions with their visible answers, and the same words again as a
 * FAQPage transcript for machines — one source array, so the schema can
 * never drift from what the page actually says.
 */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  }).replace(/</g, '\\u003c');
  return (
    <section style={{ marginTop: 44 }}>
      <h2 style={{ margin: 0, fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-display)', letterSpacing: 'var(--tr-tight)' }}>
        Questions, answered
      </h2>
      <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surf)' }}>
        {items.map((it, i) => (
          <div key={it.q} style={{ padding: '14px 18px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-bold)' }}>{it.q}</h3>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-body)', lineHeight: 1.65, color: 'var(--mut)' }}>{it.a}</p>
          </div>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </section>
  );
}

/** Every page ends at the same door. */
export function Cta({ title, sub }: { title?: string; sub?: string }) {
  return (
    <section
      style={{
        marginTop: 44,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surf)',
        padding: 'clamp(26px,4vw,40px) 22px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '-40%',
          background: 'radial-gradient(ellipse at 50% 130%, var(--acc-soft), transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative' }}>
        <h2 style={{ margin: 0, fontWeight: 'var(--fw-heavy)', fontSize: 'clamp(var(--fs-display),3.5vw,28px)', letterSpacing: '-0.03em' }}>
          {title ?? 'Paste an address. See everything.'}
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 'var(--fs-body)', color: 'var(--mut)', lineHeight: 1.6 }}>
          {sub ?? 'Free for one portfolio and five wallets — try any address without signing up.'}
        </p>
        <ButtonLink size="lg" href="/" style={{ marginTop: 20 }}>
          Create portfolio
        </ButtonLink>
      </div>
    </section>
  );
}
