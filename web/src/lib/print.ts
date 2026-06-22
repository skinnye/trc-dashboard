/**
 * Печать «красивой выгрузки»: открывает отдельное окно с чистым A4-отчётом
 * (белый фон, таблица, опц. график-картинка) и вызывает печать. Пустые
 * строки скрывает вызывающий код — чтобы помещалось на один лист.
 */
export type PrintCell = string | { text: string; color?: string; bold?: boolean };
export interface PrintColumn { label: string; align?: 'left' | 'right' }

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export function printReport(opts: {
  title: string;
  meta?: string[];
  chartDataUrl?: string;
  columns: PrintColumn[];
  rows: PrintCell[][];
  footnote?: string;
  orientation?: 'portrait' | 'landscape';
}) {
  const { title, meta = [], chartDataUrl, columns, rows, footnote, orientation = 'portrait' } = opts;

  const cell = (c: PrintCell, align?: string) => {
    const v = typeof c === 'string' ? { text: c } : c;
    const style = [
      `text-align:${align || 'left'}`,
      v.color ? `color:${v.color}` : '',
      v.bold ? 'font-weight:700' : '',
    ].filter(Boolean).join(';');
    return `<td style="${style}">${esc(v.text)}</td>`;
  };
  const thead = `<tr>${columns.map(c => `<th style="text-align:${c.align || 'left'}">${esc(c.label)}</th>`).join('')}</tr>`;
  const tbody = rows.map(r => `<tr>${r.map((c, i) => cell(c, columns[i]?.align)).join('')}</tr>`).join('');
  const now = new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });

  const css = `
    @page { size: A4 ${orientation}; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html,body { margin:0; padding:0; }
    body { font-family: 'Inter','Segoe UI',Arial,sans-serif; color:#111; padding:4px 2px; }
    header { border-bottom:2px solid #111; padding-bottom:6px; margin-bottom:10px; }
    .brand { font-size:9px; color:#777; text-transform:uppercase; letter-spacing:1.2px; }
    h1 { font-size:17px; margin:3px 0 2px; }
    .meta { font-size:11px; color:#444; line-height:1.45; }
    img.chart { display:block; width:100%; max-height:78mm; object-fit:contain; margin:6px 0 8px; }
    table { width:100%; border-collapse:collapse; font-size:10px; }
    th { background:#eef0f2; border-bottom:1px solid #9aa3ad; padding:4px 7px; font-size:9px;
         text-transform:uppercase; letter-spacing:.4px; color:#333; }
    td { padding:3px 7px; border-bottom:1px solid #e6e8ea; }
    tr:nth-child(even) td { background:#fafbfc; }
    tbody tr:last-child td { border-bottom:1px solid #9aa3ad; }
    footer { margin-top:10px; font-size:9px; color:#999; text-align:right; }
    @media print { .noprint { display:none } }
  `;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${css}</style></head><body>
    <header>
      <div class="brand">ТРЦ Академический · Дашборд</div>
      <h1>${esc(title)}</h1>
      ${meta.map(m => `<div class="meta">${esc(m)}</div>`).join('')}
    </header>
    ${chartDataUrl ? `<img class="chart" src="${chartDataUrl}" alt="график" />` : ''}
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
    <footer>${footnote ? esc(footnote) + ' · ' : ''}Напечатано ${esc(now)}</footer>
    </body></html>`;

  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { alert('Разрешите всплывающие окна, чтобы напечатать отчёт.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();

  const go = () => { try { w.focus(); w.print(); } catch { /* noop */ } };
  if (chartDataUrl) {
    const img = w.document.querySelector('img.chart') as HTMLImageElement | null;
    if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 800); }
    else setTimeout(go, 250);
  } else {
    setTimeout(go, 200);
  }
}
