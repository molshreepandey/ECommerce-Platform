import request from 'supertest';

export const appBaseUrl = process.env['APP_BASE_URL'] ?? 'http://127.0.0.1:3000';

export const storeHost = 'store.localhost:3000';
export const adminHost = 'admin.localhost:3000';

export function getPage(host: string, pathname: string) {
  return request(appBaseUrl).get(pathname).set('Host', host).set('Accept', 'text/html');
}

export function visibleMarkup(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, '');
}
