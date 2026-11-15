import { z } from 'zod';

import { DomainError } from './errors';

// RFC 4180 CSV for the admin uploads and exports (D8, D16, D41), written here so no CSV dependency is
// needed. Uploads arrive as JSON `{ csv }` so the normal body parser, origin check and size rules apply.
export const maximumCsvCharacters = 1_000_000;
export const maximumCsvRows = 2_000;

export const csvUploadSchema = z.strictObject({
  csv: z
    .string()
    .min(1, 'Choose a CSV file')
    .max(maximumCsvCharacters, 'The file is larger than 1 MB'),
});

export class CsvFormatError extends Error {
  constructor(readonly line: number) {
    super(`Unterminated quoted field starting on line ${String(line)}`);
    this.name = 'CsvFormatError';
  }
}

// Returns rows of cells; a trailing newline does not add an empty row, and a byte-order mark is ignored.
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let isQuoted = false;
  let quoteStartLine = 1;
  let line = 1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (isQuoted) {
      if (character === '"' && source.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        isQuoted = false;
      } else {
        if (character === '\n') line += 1;
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell === '') {
      isQuoted = true;
      quoteStartLine = line;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source.charAt(index + 1) === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      line += 1;
    } else {
      cell += character;
    }
  }
  if (isQuoted) throw new CsvFormatError(quoteStartLine);
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

// A cell a spreadsheet would run as a formula (=, +, -, @, tab, carriage return) is prefixed with ' so
// an exported value can never execute (CSV injection).
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export type CsvCell = string | number | boolean | null;

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((cells) =>
    cells
      .map((cell) => {
        if (cell === null) return '';
        if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
        return quote(safeCell(cell));
      })
      .join(','),
  );
  return `${lines.join('\r\n')}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '-')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export interface CsvRowError {
  line: number;
  messages: string[];
}

// Header names (case-insensitive, trimmed) mapped to objects; extra columns are reported, not ignored.
export function csvRecords(
  text: string,
  expectedColumns: readonly string[],
): { records: { line: number; values: Record<string, string> }[]; headerErrors: string[] } {
  const [header = [], ...body] = parseCsv(text);
  const names = header.map((name) => name.trim().toLowerCase());
  const missing = expectedColumns.filter((column) => !names.includes(column));
  const unknown = names.filter((name) => name !== '' && !expectedColumns.includes(name));
  const headerErrors = [
    ...(missing.length > 0 ? [`Missing columns: ${missing.join(', ')}`] : []),
    ...(unknown.length > 0 ? [`Unknown columns: ${unknown.join(', ')}`] : []),
    ...(body.length > maximumCsvRows ? [`At most ${String(maximumCsvRows)} rows per file`] : []),
  ];
  if (headerErrors.length > 0) return { records: [], headerErrors };
  return {
    records: body.map((cells, index) => ({
      line: index + 2,
      values: Object.fromEntries(names.map((name, column) => [name, (cells[column] ?? '').trim()])),
    })),
    headerErrors,
  };
}

// The upload services' entry point: a malformed file or header is one 422 for the whole file; row
// problems are reported per row by the caller.
export function csvRecordsOrThrow(text: string, expectedColumns: readonly string[]) {
  let parsed: ReturnType<typeof csvRecords>;
  try {
    parsed = csvRecords(text, expectedColumns);
  } catch (error) {
    if (!(error instanceof CsvFormatError)) throw error;
    throw new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'CSV_INVALID',
      message: error.message,
      details: { line: error.line },
    });
  }
  if (parsed.headerErrors.length > 0) {
    throw new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'CSV_HEADER_INVALID',
      message: parsed.headerErrors.join('. '),
      details: { expectedColumns },
    });
  }
  return parsed.records;
}

export function zodMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
  );
}
