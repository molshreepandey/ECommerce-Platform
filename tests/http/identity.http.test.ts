import { randomInt } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { demoPassword } from '../../prisma/seed/demo-credentials';
import {
  adminHost,
  callApi,
  getPage,
  sessionCookieFrom,
  storeHost,
  visibleMarkup,
} from './app-server';
import { runOnTestDatabase } from './support/test-database-writer';

const runId = `${Date.now()}-${randomInt(1_000_000)}`;
const customerPassword = 'Http-Test-Password-2026';

function uniqueCustomer(label: string) {
  return {
    fullName: 'Http Test Customer',
    email: `http.${label}.${runId}@example.test`,
    phone: `9${String(randomInt(100_000_000, 999_999_999))}`,
    password: customerPassword,
  };
}

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown() }),
});
const customerBody = z.object({
  customer: z.strictObject({
    id: z.uuid(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
  }),
});
const addressBody = z.object({ address: z.object({ id: z.uuid(), isDefault: z.boolean() }) });

async function registeredCustomerCookie(label: string): Promise<string> {
  const response = await callApi('post', 'store', '/api/store/auth/register', {
    body: uniqueCustomer(label),
  });
  expect(response.status).toBe(201);
  return sessionCookieFrom(response.headers['set-cookie'], 'store_session');
}

async function staffCookie(email: string): Promise<string> {
  const response = await callApi('post', 'admin', '/api/admin/auth/login', {
    body: { email, password: demoPassword },
  });
  expect(response.status).toBe(200);
  return sessionCookieFrom(response.headers['set-cookie'], 'admin_session');
}

describe('customer registration over HTTP', () => {
  it('answers 201 with the profile (no password hash) and an HttpOnly, SameSite=Lax session cookie', async () => {
    const customer = uniqueCustomer('register');
    const response = await callApi('post', 'store', '/api/store/auth/register', {
      body: { ...customer, email: customer.email.toUpperCase() },
    });
    expect(response.status).toBe(201);
    const body = customerBody.parse(response.body);
    expect(body.customer.email).toBe(customer.email);

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^store_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
    // The test config uses plain http, so Secure and the __Host- prefix are off here (on in staging/production).
    expect(setCookie).not.toContain('Secure');
  });

  it('refuses a POST from another origin with 403 ORIGIN_NOT_ALLOWED and creates nothing', async () => {
    const customer = uniqueCustomer('cross-origin');
    const crossSite = await callApi('post', 'store', '/api/store/auth/register', {
      body: customer,
      origin: 'http://evil.localhost:3100',
    });
    expect(crossSite.status).toBe(403);
    expect(errorEnvelope.parse(crossSite.body).error).toMatchObject({
      code: 'ORIGIN_NOT_ALLOWED',
      details: { reason: 'ORIGIN_MISMATCH' },
    });
    const missingOrigin = await callApi('post', 'store', '/api/store/auth/register', {
      body: customer,
      origin: null,
    });
    expect(missingOrigin.status).toBe(403);
    const adminOriginOnStore = await callApi('post', 'store', '/api/store/auth/register', {
      body: customer,
      origin: 'http://admin.localhost:3100',
    });
    expect(adminOriginOnStore.status).toBe(403);

    const login = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email: customer.email, password: customerPassword },
    });
    expect(login.status).toBe(401);
  });

  it('answers 400 with field errors for invalid input and INVALID_JSON for a broken body', async () => {
    const invalid = await callApi('post', 'store', '/api/store/auth/register', {
      body: { fullName: 'A', email: 'not-an-email', phone: '12345', password: 'short' },
    });
    expect(invalid.status).toBe(400);
    const envelope = errorEnvelope.parse(invalid.body);
    expect(envelope.error.code).toBe('VALIDATION_FAILED');
    expect(
      Object.keys(
        z.object({ fieldErrors: z.record(z.string(), z.unknown()) }).parse(envelope.error.details)
          .fieldErrors,
      ).sort(),
    ).toEqual(['email', 'fullName', 'password', 'phone']);

    const broken = await callApi('post', 'store', '/api/store/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(broken.status).toBe(400);
    expect(errorEnvelope.parse(broken.body).error.code).toBe('INVALID_JSON');
  });

  it('answers 409 for an email that is already registered', async () => {
    const customer = uniqueCustomer('duplicate');
    await callApi('post', 'store', '/api/store/auth/register', { body: customer });
    const again = await callApi('post', 'store', '/api/store/auth/register', {
      body: { ...customer, phone: `9${String(randomInt(100_000_000, 999_999_999))}` },
    });
    expect(again.status).toBe(409);
    expect(errorEnvelope.parse(again.body).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('customer sign-in over HTTP', () => {
  it('returns byte-identical 401 bodies for an unknown email and a wrong password', async () => {
    const customer = uniqueCustomer('login');
    await callApi('post', 'store', '/api/store/auth/register', { body: customer });
    const unknown = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email: `nobody.${runId}@example.test`, password: customerPassword },
    });
    const wrong = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email: customer.email, password: 'Wrong-Password-1' },
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrong.text).toBe(unknown.text);
    expect(unknown.headers['set-cookie']).toBeUndefined();
    expect(errorEnvelope.parse(unknown.body).error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
      details: null,
    });
  });

  it('returns the same status, body and headers for unknown, wrong, blocked and deactivated accounts', async () => {
    const customer = uniqueCustomer('blocked');
    await callApi('post', 'store', '/api/store/auth/register', { body: customer });
    expect(
      await runOnTestDatabase(
        "UPDATE customers SET status = 'BLOCKED', blocked_at = now() WHERE email = $1",
        [customer.email],
      ),
    ).toBe(1);
    const deactivatedEmail = `deactivated.${runId}@demo-store.test`;
    expect(
      await runOnTestDatabase(
        `INSERT INTO staff_users (full_name, email, password_hash, status)
         SELECT 'Deactivated Staff', $1, password_hash, 'DEACTIVATED' FROM staff_users
         WHERE email = 'support@demo-store.test'`,
        [deactivatedEmail],
      ),
    ).toBe(1);

    const attempts = {
      storeUnknownEmail: callApi('post', 'store', '/api/store/auth/login', {
        body: { email: `nobody.${runId}@example.test`, password: customerPassword },
      }),
      storeWrongPassword: callApi('post', 'store', '/api/store/auth/login', {
        body: { email: customer.email, password: 'Wrong-Password-1' },
      }),
      storeBlockedCorrectPassword: callApi('post', 'store', '/api/store/auth/login', {
        body: { email: customer.email, password: customerPassword },
      }),
      adminUnknownEmail: callApi('post', 'admin', '/api/admin/auth/login', {
        body: { email: `nobody.${runId}@demo-store.test`, password: demoPassword },
      }),
      adminWrongPassword: callApi('post', 'admin', '/api/admin/auth/login', {
        body: { email: 'support@demo-store.test', password: 'Wrong-Password-1' },
      }),
      adminDeactivatedCorrectPassword: callApi('post', 'admin', '/api/admin/auth/login', {
        body: { email: deactivatedEmail, password: demoPassword },
      }),
    };
    const responses = [];
    for (const [label, attempt] of Object.entries(attempts)) {
      const response = await attempt;
      const headers = Object.fromEntries(
        Object.entries(response.headers).filter(
          ([name]) => !['x-request-id', 'date'].includes(name),
        ),
      );
      responses.push({ label, status: response.status, body: response.text, headers });
    }
    const [first, ...rest] = responses;
    expect(first?.status).toBe(401);
    expect(first?.body).toBe(
      '{"error":{"code":"INVALID_CREDENTIALS","message":"The email or password is incorrect.","details":null}}',
    );
    expect(first?.headers).not.toHaveProperty('set-cookie');
    for (const response of rest) {
      expect({ ...response, label: first?.label }).toEqual(first);
    }
  });

  it('protects account APIs with 401 and serves them with a valid cookie', async () => {
    const anonymous = await callApi('get', 'store', '/api/store/account/profile');
    expect(anonymous.status).toBe(401);
    expect(errorEnvelope.parse(anonymous.body).error.code).toBe('UNAUTHENTICATED');

    const cookie = await registeredCustomerCookie('profile');
    const profile = await callApi('get', 'store', '/api/store/account/profile', { cookie });
    expect(profile.status).toBe(200);

    const updated = await callApi('patch', 'store', '/api/store/account/profile', {
      cookie,
      body: { fullName: 'Renamed Over Http' },
    });
    expect(updated.status).toBe(200);
    expect(
      z.object({ profile: z.object({ fullName: z.string() }) }).parse(updated.body).profile
        .fullName,
    ).toBe('Renamed Over Http');
  });

  it('signs out: clears the cookie and the old token stops working', async () => {
    const cookie = await registeredCustomerCookie('logout');
    const logout = await callApi('post', 'store', '/api/store/auth/logout', { cookie });
    expect(logout.status).toBe(204);
    expect(String(logout.headers['set-cookie'])).toMatch(
      /^store_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/,
    );
    const afterwards = await callApi('get', 'store', '/api/store/account/profile', { cookie });
    expect(afterwards.status).toBe(401);
  });

  it('signs out everywhere: every session of the customer stops working', async () => {
    const customer = uniqueCustomer('logout-all');
    const registration = await callApi('post', 'store', '/api/store/auth/register', {
      body: customer,
    });
    const firstCookie = sessionCookieFrom(registration.headers['set-cookie'], 'store_session');
    const secondLogin = await callApi('post', 'store', '/api/store/auth/login', {
      body: { email: customer.email, password: customerPassword },
    });
    const secondCookie = sessionCookieFrom(secondLogin.headers['set-cookie'], 'store_session');

    const logoutAll = await callApi('post', 'store', '/api/store/auth/logout-all', {
      cookie: firstCookie,
    });
    expect(logoutAll.status).toBe(200);
    expect(logoutAll.body).toEqual({ revokedSessionCount: 2 });
    for (const cookie of [firstCookie, secondCookie]) {
      expect((await callApi('get', 'store', '/api/store/account/profile', { cookie })).status).toBe(
        401,
      );
    }
  });
});

describe('addresses over HTTP', () => {
  const address = {
    recipientName: 'Http Recipient',
    phone: '9876504000',
    addressLine1: '7 Brigade Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560025',
  };

  it('creates, edits, sets default and archives, and hides one customer’s address from another', async () => {
    const cookie = await registeredCustomerCookie('addresses');
    const first = await callApi('post', 'store', '/api/store/account/addresses', {
      cookie,
      body: address,
    });
    expect(first.status).toBe(201);
    const firstAddress = addressBody.parse(first.body).address;
    expect(firstAddress.isDefault).toBe(true);
    const second = addressBody.parse(
      (
        await callApi('post', 'store', '/api/store/account/addresses', {
          cookie,
          body: { ...address, addressLine1: '8 Brigade Road' },
        })
      ).body,
    ).address;

    const edited = await callApi('patch', 'store', `/api/store/account/addresses/${second.id}`, {
      cookie,
      body: { landmark: 'Opposite the metro' },
    });
    expect(edited.status).toBe(200);

    const madeDefault = await callApi(
      'post',
      'store',
      `/api/store/account/addresses/${second.id}/default`,
      { cookie },
    );
    expect(addressBody.parse(madeDefault.body).address.isDefault).toBe(true);

    const intruderCookie = await registeredCustomerCookie('intruder');
    for (const attempt of [
      callApi('patch', 'store', `/api/store/account/addresses/${second.id}`, {
        cookie: intruderCookie,
        body: { city: 'Mysuru' },
      }),
      callApi('delete', 'store', `/api/store/account/addresses/${second.id}`, {
        cookie: intruderCookie,
      }),
      callApi('post', 'store', `/api/store/account/addresses/${second.id}/default`, {
        cookie: intruderCookie,
      }),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(404);
      expect(errorEnvelope.parse(response.body).error.code).toBe('ADDRESS_NOT_FOUND');
    }

    const archived = await callApi('delete', 'store', `/api/store/account/addresses/${second.id}`, {
      cookie,
    });
    expect(archived.status).toBe(204);
    const list = z
      .object({ addresses: z.array(z.object({ id: z.string(), isDefault: z.boolean() })) })
      .parse((await callApi('get', 'store', '/api/store/account/addresses', { cookie })).body);
    expect(list.addresses).toEqual([
      expect.objectContaining({ id: firstAddress.id, isDefault: true }),
    ]);
  });

  it('answers 400 for an address id that is not a UUID', async () => {
    const cookie = await registeredCustomerCookie('bad-id');
    const response = await callApi('delete', 'store', '/api/store/account/addresses/not-a-uuid', {
      cookie,
    });
    expect(response.status).toBe(400);
    expect(errorEnvelope.parse(response.body).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('staff sign-in and account separation over HTTP', () => {
  it('signs staff in with the demo password and reports roles and permissions', async () => {
    const cookie = await staffCookie('support@demo-store.test');
    const me = await callApi('get', 'admin', '/api/admin/auth/me', { cookie });
    expect(me.status).toBe(200);
    const staffUser = z
      .object({
        staffUser: z.object({
          email: z.string(),
          roles: z.array(z.object({ code: z.string() })),
          permissionCodes: z.array(z.string()),
        }),
      })
      .parse(me.body).staffUser;
    expect(staffUser.email).toBe('support@demo-store.test');
    expect(staffUser.roles.map(({ code }) => code)).toEqual(['SUPPORT']);
    expect(staffUser.permissionCodes).not.toContain('staff.manage');
  });

  it('refuses a customer session on the admin API with 403 and ignores the store cookie there', async () => {
    const storeCookie = await registeredCustomerCookie('separation');
    const customerToken = storeCookie.split('=')[1] ?? '';
    const asAdminCookie = await callApi('get', 'admin', '/api/admin/auth/me', {
      cookie: `admin_session=${customerToken}`,
    });
    expect(asAdminCookie.status).toBe(403);
    expect(errorEnvelope.parse(asAdminCookie.body).error.code).toBe('WRONG_ACCOUNT_TYPE');

    const storeCookieOnAdmin = await callApi('get', 'admin', '/api/admin/auth/me', {
      cookie: storeCookie,
    });
    expect(storeCookieOnAdmin.status).toBe(401);
  });

  it('keeps store APIs off the admin host and admin APIs off the store host', async () => {
    expect((await callApi('post', 'admin', '/api/store/auth/login', { body: {} })).status).toBe(
      404,
    );
    expect((await callApi('post', 'store', '/api/admin/auth/login', { body: {} })).status).toBe(
      404,
    );
  });
});

describe('page access over HTTP', () => {
  it('redirects signed-out visitors from account pages to sign-in with a return path', async () => {
    const response = await getPage(storeHost, '/account/addresses');
    expect(response.status).toBe(307);
    expect(response.headers['location']).toBe(
      'http://store.localhost:3100/login?next=%2Faccount%2Faddresses',
    );
  });

  it('renders the account page for a signed-in customer', async () => {
    const cookie = await registeredCustomerCookie('account-page');
    const response = await getPage(storeHost, '/account', cookie);
    expect(response.status).toBe(200);
    expect(visibleMarkup(response.text)).toContain('Http Test Customer');
  });

  it('renders the dashboard with the signed-in staff member and role', async () => {
    const cookie = await staffCookie('order.ops@demo-store.test');
    const response = await getPage(adminHost, '/', cookie);
    expect(response.status).toBe(200);
    const markup = visibleMarkup(response.text);
    expect(markup).toContain('Vikram Shah');
    expect(markup).toContain('order.ops@demo-store.test');
  });

  it('redirects a stale admin cookie from the dashboard to sign-in', async () => {
    const response = await getPage(adminHost, '/', 'admin_session=revoked-or-made-up');
    // The proxy only checks that a cookie exists; the page verifies it and redirects while streaming.
    expect(visibleMarkup(response.text)).not.toContain('Your access');
    expect(response.text).toContain('/login');
  });
});
