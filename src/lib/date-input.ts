// <input type="datetime-local"> works in the browser's time zone; the APIs take ISO timestamps with an
// offset. An empty input means "no date".
export function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

export function fromLocalInput(text: string): string | null {
  if (text.trim() === '') return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}
