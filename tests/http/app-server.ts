import request from 'supertest';

import { adminHost, adminOrigin, appBaseUrl, storeHost, storeOrigin } from '../support/test-app';

export { adminHost, adminOrigin, appBaseUrl, storeHost, storeOrigin };

// Any value passes the proxy's cookie-presence check; pages that need a real session still verify it.
export const placeholderAdminCookie = 'admin_session=placeholder-for-the-proxy-check';

export function getPage(host: string, pathname: string, cookie?: string) {
  const pageRequest = request(appBaseUrl)
    .get(pathname)
    .set('Host', host)
    .set('Accept', 'text/html');
  return cookie === undefined ? pageRequest : pageRequest.set('Cookie', cookie);
}

type JsonMethod = 'get' | 'post' | 'patch' | 'delete';

export function callApi(
  method: JsonMethod,
  surface: 'store' | 'admin',
  pathname: string,
  options: { body?: object; cookie?: string; origin?: string | null } = {},
) {
  const host = surface === 'store' ? storeHost : adminHost;
  const origin =
    options.origin === undefined
      ? surface === 'store'
        ? storeOrigin
        : adminOrigin
      : options.origin;
  let apiRequest = request(appBaseUrl)
    [method](pathname)
    .set('Host', host)
    .set('Accept', 'application/json');
  if (origin !== null) apiRequest = apiRequest.set('Origin', origin);
  if (options.cookie !== undefined) apiRequest = apiRequest.set('Cookie', options.cookie);
  return options.body === undefined ? apiRequest : apiRequest.send(options.body);
}

// Returns "name=value" from a Set-Cookie header so it can be sent back on the next request.
export function sessionCookieFrom(setCookie: unknown, cookieName: string): string {
  const headers = Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie)];
  const match = headers.find((header) => header.startsWith(`${cookieName}=`));
  if (match === undefined) throw new Error(`no ${cookieName} cookie was set`);
  return match.split(';')[0] ?? '';
}

export function visibleMarkup(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, '');
}
