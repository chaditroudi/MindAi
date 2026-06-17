export function serializeRows(
  rows:     unknown[],
  maxChars: number,
): { json: string; included: number; truncated: boolean } {
  const parts: string[] = [];
  let size = 2;
  for (const row of rows) {
    const piece = JSON.stringify(row) ?? 'null';
    const cost  = piece.length + (parts.length > 0 ? 1 : 0);
    if (size + cost > maxChars) break;
    parts.push(piece);
    size += cost;
  }
  return { json: `[${parts.join(',')}]`, included: parts.length, truncated: parts.length < rows.length };
}

export function dataBlock(
  label:    string,
  rows:     unknown[],
  maxRows:  number,
  maxChars: number,
): string {
  const capped = maxRows === Infinity ? rows : rows.slice(0, maxRows);
  const { json, included, truncated } = serializeRows(capped, maxChars);
  const note = truncated || rows.length > maxRows
    ? ` (showing ${included} of ${rows.length} rows — TRUNCATED)`
    : ` (${rows.length} rows, complete)`;
  return `${label}${note}:\n${json}`;
}

export function buildInquiryMessage(prompt: string, rows: unknown[], maxRows: number, maxChars: number): string {
  return `Question: ${prompt}\n\n${dataBlock('Records', rows, maxRows, maxChars)}`;
}

export function buildReportMessage(prompt: string, rows: unknown[], maxChars: number, withChart?: boolean): string {
  const chartHint = withChart
    ? '\n\nCONTEXT: A visualization chart will be displayed alongside this report. Do NOT describe distributions or rankings in prose — the chart already shows those visually. Instead focus your sections on insights, context, comparisons, and recommendations that the chart cannot convey.'
    : '';
  return `Prompt: ${prompt}${chartHint}\n\n${dataBlock('Dataset', rows, Infinity, maxChars)}`;
}
