import { describe, expect, it } from 'vitest';

import { CsvFormatError, csvRecords, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",3\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', '3'],
    ]);
  });

  it('keeps empty cells and skips blank lines', () => {
    expect(parseCsv('a,,c\n\n,\n')).toEqual([
      ['a', '', 'c'],
      ['', ''],
    ]);
  });

  it('refuses an unterminated quote with its line', () => {
    expect(() => parseCsv('a\n"open,1\n')).toThrow(CsvFormatError);
  });
});

describe('toCsv', () => {
  it('quotes when needed and neutralises formulas', () => {
    expect(
      toCsv(
        ['name', 'amount'],
        [
          ['=HYPERLINK("x")', 12],
          ['a,b', null],
          ['-5', true],
        ],
      ),
    ).toBe('name,amount\r\n"\'=HYPERLINK(""x"")",12\r\n"a,b",\r\n\'-5,true\r\n');
  });

  it('round-trips through parseCsv', () => {
    const rows = [['plain', 'with "quotes"', 'multi\nline']];
    expect(parseCsv(toCsv(['a', 'b', 'c'], rows))).toEqual([['a', 'b', 'c'], ...rows]);
  });
});

describe('csvRecords', () => {
  it('maps headers case-insensitively and numbers lines from the header', () => {
    expect(csvRecords('Pincode, ETA_days\n411001,3\n', ['pincode', 'eta_days'])).toEqual({
      records: [{ line: 2, values: { pincode: '411001', eta_days: '3' } }],
      headerErrors: [],
    });
  });

  it('reports missing and unknown columns', () => {
    expect(csvRecords('pincode,extra\n1,2\n', ['pincode', 'eta_days']).headerErrors).toEqual([
      'Missing columns: eta_days',
      'Unknown columns: extra',
    ]);
  });
});
