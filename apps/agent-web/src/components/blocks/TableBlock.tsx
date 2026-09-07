import type { TableBlock } from '../../app/types';

/* The wire preformats numbers; the leading sign is the only tone signal.
   Negatives arrive as U+2212 minus or an ASCII "-$". */
function cellTone(text: string): 'down' | undefined {
  return text.startsWith('−') || text.startsWith('-$') ? 'down' : undefined;
}

export default function TableBlockView({ block }: { block: TableBlock }) {
  const colClass = (mobile?: boolean) => (mobile === false ? 'sv-a-b-desktop-only' : undefined);
  return (
    <div className="sv-a-b-card sv-a-b-table-card">
      <div className="sv-a-b-table-scroll">
        <table className="sv-a-b-table">
          <thead>
            <tr>
              {block.columns.map((col) => (
                <th key={col.key} data-align={col.align} className={colClass(col.mobile)}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {block.columns.map((col) => {
                  const text = row[col.key] ?? '';
                  return (
                    <td
                      key={col.key}
                      data-align={col.align}
                      data-tone={cellTone(text)}
                      className={colClass(col.mobile)}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note ? <div className="sv-a-b-table-note">{block.note}</div> : null}
    </div>
  );
}
