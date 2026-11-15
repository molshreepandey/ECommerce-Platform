'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { useAdminAction } from './use-admin-action';

const resultSchema = z.object({
  csvImport: z.object({
    savedCount: z.number(),
    errors: z.array(z.object({ line: z.number(), messages: z.array(z.string()) })),
  }),
});

type CsvImportResult = z.infer<typeof resultSchema>['csvImport'];

// D16 / D41: reads a CSV file in the browser and posts its text; shows how many rows were saved and
// every rejected row with its line number (rejected rows are never written).
export function CsvUploadForm({
  url,
  label,
  columns,
  extraBody = {},
}: Readonly<{
  url: string;
  label: string;
  columns: readonly string[];
  extraBody?: Readonly<Record<string, string>>;
}>) {
  const { run, isPending, failure } = useAdminAction();
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('csvFile');
    if (!(file instanceof File) || file.size === 0) {
      setFileError('Choose a CSV file.');
      return;
    }
    if (file.size > 1_000_000) {
      setFileError('The file is larger than 1 MB.');
      return;
    }
    setFileError(undefined);
    setResult(null);
    const data = await run(
      { url, method: 'POST', body: { ...extraBody, csv: await file.text() } },
      'File processed',
    );
    const parsed = resultSchema.safeParse(data);
    if (parsed.success) setResult(parsed.data.csvImport);
  }

  return (
    <form
      noValidate
      aria-label={`Upload ${label}`}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-sm"
    >
      <div className="flex flex-col gap-md md:flex-row md:items-end">
        <div className="md:w-96">
          <FormField
            label={label}
            name="csvFile"
            type="file"
            accept=".csv,text/csv"
            hint={`Columns: ${columns.join(', ')}`}
            error={fileError}
          />
        </div>
        <Button type="submit" isLoading={isPending}>
          Upload CSV
        </Button>
      </div>
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      {result === null ? null : (
        <section aria-label="Upload result" className="flex flex-col gap-xs">
          <Text variant="body2-medium">
            {result.savedCount} saved · {result.errors.length} rejected
          </Text>
          {result.errors.length === 0 ? null : (
            <ul className="flex flex-col gap-xs">
              {result.errors.map((rowError) => (
                <li key={rowError.line}>
                  <Text as="span" variant="body3" tone="danger">
                    Line {rowError.line}: {rowError.messages.join('; ')}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </form>
  );
}
