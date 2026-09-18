import type { ReactNode } from 'react';

/**
 * The little bit of markdown a chat model actually writes, rendered as React
 * elements.
 *
 * Elements, not HTML: nothing here ever reaches innerHTML, so a model that
 * emits a script tag emits four visible words instead of a script. That is the
 * whole reason not to reach for a markdown-to-HTML library plus a sanitizer —
 * the unsafe step is the one we skip.
 *
 * Deliberately partial. Bold, italic, inline code, links, headings, bullet and
 * numbered lists, fenced code, blockquotes, rules and pipe tables — what models
 * emit in chat. Images are answered by a block of their own, and anything
 * unrecognised stays the literal text the model wrote.
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const piece = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (piece.startsWith('**') || piece.startsWith('__')) {
      out.push(<strong key={key}>{piece.slice(2, -2)}</strong>);
    } else if (piece.startsWith('`')) {
      out.push(<code key={key}>{piece.slice(1, -1)}</code>);
    } else if (piece.startsWith('[')) {
      const split = piece.indexOf('](');
      const label = piece.slice(1, split);
      const href = piece.slice(split + 2, -1);
      // Only http(s) and in-product paths become links; javascript: and data:
      // stay the text they were written as.
      const safe = /^(https?:\/\/|\/)/i.test(href);
      out.push(
        safe ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <span key={key}>{piece}</span>
        ),
      );
    } else {
      out.push(<em key={key}>{piece.slice(1, -1)}</em>);
    }
    last = match.index + piece.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Align = 'right' | 'center' | undefined;

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * The table starting at `start`, or null when there is none.
 *
 * A row is a row because the line under the header is a delimiter — pipes
 * alone are a sentence about a price range, and models write those too.
 */
export function tableAt(
  lines: string[],
  start: number,
): { head: string[]; align: Align[]; rows: string[][]; next: number } | null {
  if (start + 1 >= lines.length) return null;
  const rule = lines[start + 1];
  if (!lines[start].includes('|') || !rule.includes('|') || !DELIMITER.test(rule)) return null;
  const head = cells(lines[start]);
  const marks = cells(rule);
  if (marks.length !== head.length) return null;
  const align: Align[] = marks.map((mark) =>
    mark.startsWith(':') && mark.endsWith(':') ? 'center' : mark.endsWith(':') ? 'right' : undefined,
  );
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    const row = cells(lines[i++]);
    rows.push(head.map((_, n) => row[n] ?? ''));
  }
  return { head, align, rows, next: i };
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) body.push(lines[i++]);
      i++; // the closing fence, or the end of the text
      out.push(
        <pre key={`pre-${i}`} className="sv-a-md-pre">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      out.push(
        <div key={`t-${i}`} className="sv-a-md-table-scroll">
          <table className="sv-a-b-table sv-a-md-table">
            <thead>
              <tr>
                {table.head.map((cell, n) => (
                  <th key={n} data-align={table.align[n]}>
                    {inline(cell, `th${i}-${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, n) => (
                    <td key={n} data-align={table.align[n]}>
                      {inline(cell, `td${i}-${r}-${n}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = table.next;
      continue;
    }

    if (RULE.test(line)) {
      out.push(<hr key={`hr-${i}`} className="sv-a-md-rule" />);
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // Levels collapse to two: a chat message is not a document, and h1 at
      // message size only shouts.
      const Tag = (heading[1].length <= 2 ? 'h3' : 'h4') as 'h3' | 'h4';
      out.push(
        <Tag key={`h-${i}`} className="sv-a-md-h">
          {inline(heading[2], `h${i}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      out.push(
        <blockquote key={`q-${i}`} className="sv-a-md-quote">
          {inline(body.join(' '), `q${i}`)}
        </blockquote>,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const numbered = !BULLET.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const bullet = BULLET.exec(lines[i]);
        const number = NUMBERED.exec(lines[i]);
        const item = numbered ? number : bullet;
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      const List = numbered ? 'ol' : 'ul';
      out.push(
        <List key={`l-${i}`} className="sv-a-md-list">
          {items.map((item, n) => (
            <li key={n}>{inline(item, `l${i}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // A paragraph runs to the next blank line or block opener.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !tableAt(lines, i) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={`p-${i}`} className="sv-a-md-p">
        {para.map((l, n) => (
          <span key={n}>
            {inline(l, `p${i}-${n}`)}
            {n < para.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="sv-a-md">{out}</div>;
}
