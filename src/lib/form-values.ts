// Reads text fields from a submitted form; a missing or file field reads as "".
export function formReader(form: HTMLFormElement): (name: string) => string {
  const data = new FormData(form);
  return (name) => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
}
