// Images are external URLs (plan §10B). Only https origins the Content-Security-Policy already allows
// are accepted, so a saved image can never be one the browser would refuse to show.
export function allowedImageOrigins(contentSecurityImageSources: readonly string[]): string[] {
  return contentSecurityImageSources.filter((source) => source.startsWith('https://'));
}

export function isAllowedImageUrl(url: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
    return false;
  return allowedOrigins.includes(parsed.origin);
}
