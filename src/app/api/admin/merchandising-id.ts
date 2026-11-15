import { z } from 'zod';

import { DomainError } from '@/lib/errors';

export async function uuidParam(
  params: Promise<Record<string, string>>,
  name: string,
  code: string,
): Promise<string> {
  const parsed = z.uuid().safeParse((await params)[name]);
  if (!parsed.success) throw new DomainError({ kind: 'NOT_FOUND', code, message: 'Not found' });
  return parsed.data.toLowerCase();
}
