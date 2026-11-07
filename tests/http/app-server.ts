import request from 'supertest';

import { adminHost, appBaseUrl, storeHost } from '../support/test-app';

export { adminHost, appBaseUrl, storeHost };

export function getPage(host: string, pathname: string) {
  return request(appBaseUrl).get(pathname).set('Host', host).set('Accept', 'text/html');
}

export function visibleMarkup(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, '');
}
