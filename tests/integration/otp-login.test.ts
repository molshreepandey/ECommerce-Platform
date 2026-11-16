import { createHash, randomInt } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { requestLoginOtp, verifyLoginOtp } from '@/modules/identity/otp-login.service';
import type { OtpSender } from '@/modules/identity/otp-sender';

import { testMetadata } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const originalSetting = process.env['OTP_DISPLAY_IN_UI'];

// Captures what the log sender would write, so the tests know the code even when the UI hides it.
function capturingSender() {
  const sent: { phone: string; code: string }[] = [];
  const sender: OtpSender = {
    key: 'test_sender',
    send(input) {
      sent.push({ phone: input.phone, code: input.code });
      return Promise.resolve();
    },
  };
  return { sender, sent };
}

async function customerWithPhone(status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE'): Promise<string> {
  const phone = `9${String(randomInt(100_000_000, 1_000_000_000))}`;
  await database.customer.create({
    data: {
      fullName: 'Otp Customer',
      email: `otp.${phone}@example.test`,
      phone,
      passwordHash: 'not-a-real-hash',
      status,
    },
  });
  return phone;
}

async function codeOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) =>
      error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error),
  );
}

async function expireCooldown(phone: string) {
  await database.otpChallenge.updateMany({
    where: { phone },
    data: { lastSentAt: new Date(Date.now() - 31_000) },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

afterEach(() => {
  if (originalSetting === undefined) delete process.env['OTP_DISPLAY_IN_UI'];
  else process.env['OTP_DISPLAY_IN_UI'] = originalSetting;
});

describe('OTP login (C3)', () => {
  it('issues a hashed 6-digit code, shows it in the demo, and signs in once', async () => {
    process.env['OTP_DISPLAY_IN_UI'] = 'true';
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    const issued = await requestLoginOtp({ phone }, testMetadata(), sender);
    expect(issued.displayedOtpCode).toMatch(/^\d{6}$/);
    expect(sent).toEqual([{ phone, code: issued.displayedOtpCode }]);
    const stored = await database.otpChallenge.findFirstOrThrow({ where: { phone } });
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.codeHash).not.toContain(issued.displayedOtpCode);

    const signedIn = await verifyLoginOtp(
      { phone, code: issued.displayedOtpCode ?? '' },
      testMetadata(),
    );
    expect(signedIn.session.sessionToken).toBeTruthy();
    expect(await database.auditLog.count({ where: { action: 'customer.otp_login' } })).toBe(1);
    expect(
      await codeOf(verifyLoginOtp({ phone, code: issued.displayedOtpCode ?? '' }, testMetadata())),
    ).toBe('401 OTP_INVALID');
  });

  it('never returns the code when OTP_DISPLAY_IN_UI=false (it only goes to the sender)', async () => {
    process.env['OTP_DISPLAY_IN_UI'] = 'false';
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    const issued = await requestLoginOtp({ phone }, testMetadata(), sender);
    expect(issued).not.toHaveProperty('displayedOtpCode');
    expect(sent).toHaveLength(1);
  });

  it('refuses an expired code', async () => {
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    await requestLoginOtp({ phone }, testMetadata(), sender);
    await database.otpChallenge.updateMany({
      where: { phone },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await codeOf(verifyLoginOtp({ phone, code: sent[0]?.code ?? '' }, testMetadata()))).toBe(
      '401 OTP_EXPIRED',
    );
  });

  it('locks the challenge after 5 wrong codes, even for the right one', async () => {
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    await requestLoginOtp({ phone }, testMetadata(), sender);
    const right = sent[0]?.code ?? '';
    const wrong = right === '000000' ? '111111' : '000000';
    const outcomes = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      outcomes.push(await codeOf(verifyLoginOtp({ phone, code: wrong }, testMetadata())));
    }
    expect(outcomes).toEqual([
      '401 OTP_INVALID',
      '401 OTP_INVALID',
      '401 OTP_INVALID',
      '401 OTP_INVALID',
      '401 OTP_LOCKED',
    ]);
    expect(await codeOf(verifyLoginOtp({ phone, code: right }, testMetadata()))).toBe(
      '401 OTP_LOCKED',
    );
  });

  it('a parallel burst of guesses uses up exactly the 5 attempts and signs nobody in (SEC-2)', async () => {
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    await requestLoginOtp({ phone }, testMetadata(), sender);
    const right = sent[0]?.code ?? '';
    // Twelve different wrong codes at once. The race this guards (a right code inside such a burst being
    // compared after the attempts ran out) depends on timing, so it is prevented by construction instead:
    // each attempt is claimed by one guarded UPDATE before its code is compared.
    const wrongCodes = Array.from({ length: 12 }, (_, index) =>
      String((Number(right) + index + 1) % 1_000_000).padStart(6, '0'),
    );
    await Promise.all(
      wrongCodes.map((code) => codeOf(verifyLoginOtp({ phone, code }, testMetadata()))),
    );
    const stored = await database.otpChallenge.findFirstOrThrow({ where: { phone } });
    expect(stored.attemptCount).toBe(5);
    expect(await codeOf(verifyLoginOtp({ phone, code: right }, testMetadata()))).toBe(
      '401 OTP_LOCKED',
    );
    expect(await database.session.count()).toBe(0);
  });

  it('signs in with the right code on the fifth and last attempt', async () => {
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    await requestLoginOtp({ phone }, testMetadata(), sender);
    const right = sent[0]?.code ?? '';
    const wrong = right === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await codeOf(verifyLoginOtp({ phone, code: wrong }, testMetadata()))).toBe(
        '401 OTP_INVALID',
      );
    }
    const signedIn = await verifyLoginOtp({ phone, code: right }, testMetadata());
    expect(signedIn.customerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('enforces the 30-second resend cooldown, then issues a new code that replaces the old one', async () => {
    const phone = await customerWithPhone();
    const { sender, sent } = capturingSender();
    await requestLoginOtp({ phone }, testMetadata(), sender);
    expect(await codeOf(requestLoginOtp({ phone }, testMetadata(), sender))).toBe(
      '429 OTP_RESEND_COOLDOWN',
    );
    await expireCooldown(phone);
    await requestLoginOtp({ phone }, testMetadata(), sender);
    const [first, second] = sent;
    if (first !== undefined && second !== undefined && first.code !== second.code) {
      expect(await codeOf(verifyLoginOtp({ phone, code: first.code }, testMetadata()))).toBe(
        '401 OTP_INVALID',
      );
    }
    await verifyLoginOtp({ phone, code: second?.code ?? '' }, testMetadata());
  });

  it('answers an unknown or blocked number the same way, with the same cooldown, and never signs it in', async () => {
    process.env['OTP_DISPLAY_IN_UI'] = 'true';
    const blocked = await customerWithPhone('BLOCKED');
    const { sender, sent } = capturingSender();
    for (const phone of ['9000000001', blocked]) {
      const issued = await requestLoginOtp({ phone }, testMetadata(), sender);
      expect(issued).not.toHaveProperty('displayedOtpCode');
      expect(Object.keys(issued).sort()).toEqual(['expiresAt', 'resendAvailableAt']);
      expect(await codeOf(requestLoginOtp({ phone }, testMetadata(), sender))).toBe(
        '429 OTP_RESEND_COOLDOWN',
      );
      // Even the right code of that challenge is refused: no active customer has the number.
      const challenge = await database.otpChallenge.findFirstOrThrow({
        where: { phone },
        select: { id: true },
      });
      await database.otpChallenge.update({
        where: { id: challenge.id },
        data: { codeHash: createHash('sha256').update(`${challenge.id}:123456`).digest('hex') },
      });
      expect(await codeOf(verifyLoginOtp({ phone, code: '123456' }, testMetadata()))).toBe(
        '401 OTP_INVALID',
      );
    }
    expect(sent).toHaveLength(0);
    expect(await database.session.count()).toBe(0);
  });
});
