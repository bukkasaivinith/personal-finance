type Cell = string | number;
export type TableReport = {
  title: string;
  filename: string;
  summary: string[];
  headers: string[];
  rows: Cell[][];
  amountColumn?: number;
};

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: Cell) {
  // In CSV, spreadsheet programs may interpret user-entered descriptions as formulas.
  const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/u.test(value) ? "'" + value : String(value);
  return '"' + safe.replace(/"/g, '""') + '"';
}

function printReport(report: TableReport) {
  const frame = document.createElement('iframe');
  frame.title = report.title;
  frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(frame);
  const page = frame.contentDocument;
  const preview = frame.contentWindow;
  if (!page || !preview) { frame.remove(); throw new Error('Could not open the print preview.'); }
  const append = (parent: HTMLElement, name: string, text?: Cell) => {
    const element = page.createElement(name);
    if (text !== undefined) element.textContent = String(text);
    parent.append(element);
    return element;
  };
  page.title = report.title;
  const style = page.createElement('style');
  style.textContent = [
    '@page { margin: 16mm 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages) } }',
    'body { font: 10pt system-ui, sans-serif; color: #16251f }',
    'h1 { margin: 0 0 8pt; font-size: 17pt } p { margin: 3pt 0 }',
    'table { margin-top: 12pt; width: 100%; border-collapse: collapse; table-layout: fixed }',
    'thead { display: table-header-group; background: #edf2ee }',
    'td,th { padding: 5pt; text-align: left; vertical-align: top; border-bottom: 1px solid #aebbb2; overflow-wrap:anywhere }',
    'tr { break-inside: avoid } .amount { text-align: right; font-variant-numeric: tabular-nums }',
  ].join('\n');
  page.head.append(style);
  append(page.body, 'h1', report.title);
  for (const line of report.summary) append(page.body, 'p', line);
  append(page.body, 'p', 'Generated ' + new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));
  const table = append(page.body, 'table');
  const header = append(append(table, 'thead'), 'tr');
  report.headers.forEach((entry, index) => { if (index === report.amountColumn) append(header, 'th', entry).className = 'amount'; else append(header, 'th', entry); });
  const body = append(table, 'tbody');
  for (const row of report.rows) {
    const tr = append(body, 'tr');
    row.forEach((entry, index) => {
      const amount = index === report.amountColumn && typeof entry === 'number';
      const cell = append(tr, 'td', amount ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(entry) : entry);
      if (amount) cell.className = 'amount';
    });
  }
  preview.addEventListener('afterprint', () => frame.remove(), { once: true });
  try { preview.focus(); preview.print(); } catch (error) { frame.remove(); throw error; }
}

function worksheet(rows: Cell[][], amountColumn?: number) {
  const xmlText = (value: string) => [...value].filter((char) => {
    const point = char.codePointAt(0)!;
    return point === 9 || point === 10 || point === 13 || (point >= 32 && point !== 0xfffe && point !== 0xffff && (point < 0xd800 || point > 0xdfff));
  }).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const columns = (rows[0] ?? []).map((_, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (rows[0].length === 1 ? 85 : 22) + '" customWidth="1"/>').join('');
  const body = rows.map((row, index) => '<row>' + row.map((entry, column) => {
    const style = index === 0 ? ' s="1"' : column === amountColumn ? ' s="2"' : '';
    return typeof entry === 'number' && Number.isFinite(entry)
      ? '<c' + style + '><v>' + entry + '</v></c>'
      : '<c t="inlineStr"' + style + '><is><t xml:space="preserve">' + xmlText(String(entry)) + '</t></is></c>';
  }).join('') + '</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + columns + '</cols><sheetData>' + body + '</sheetData></worksheet>';
}

async function excelReport(report: TableReport) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const sheets = [[report.headers, ...report.rows], [[report.title], ...report.summary.map((line) => [line])]];
  const typeRoot = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const contents = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const entries = ['workbook', 'worksheets/sheet1', 'worksheets/sheet2', 'styles'];
  const override = entries.map((entry) => '<Override PartName="/xl/' + entry + '.xml" ContentType="' + contents + (entry === 'workbook' ? 'sheet.main' : entry.startsWith('worksheets/') ? 'worksheet' : entry) + '+xml"/>').join('');
  zip.file('[Content_Types].xml', '<Types xmlns="' + typeRoot + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + override + '</Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="' + relations + '"><Relationship Id="rId1" Type="' + office + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="' + relations + '">' + entries.slice(1).map((entry, index) => '<Relationship Id="rId' + (index + 1) + '" Type="' + office + '/' + (index === 2 ? 'styles' : 'worksheet') + '" Target="' + entry + '.xml"/>').join('') + '</Relationships>');
  zip.file('xl/workbook.xml', '<workbook xmlns="' + spreadsheet + '" xmlns:r="' + office + '"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/styles.xml', '<styleSheet xmlns="' + spreadsheet + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((rows, index) => zip.file('xl/worksheets/sheet' + (index + 1) + '.xml', worksheet(rows, index === 0 ? report.amountColumn : undefined)));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: contents + 'sheet' });
}

export async function downloadReport(report: TableReport, format: 'csv' | 'xlsx' | 'pdf') {
  if (format === 'pdf') { printReport(report); return; }
  if (format === 'csv') {
    const csv = [report.headers, ...report.rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    save(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), report.filename + '.csv');
    return;
  }
  save(await excelReport(report), report.filename + '.xlsx');
}
