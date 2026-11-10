// Only same-site absolute paths are accepted, so a crafted ?next= cannot send people to another site.
export function safeNextPath(candidate: string | null | undefined): string | null {
  if (candidate === null || candidate === undefined) return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;
  if (candidate.length > 512) return null;
  return candidate;
}
