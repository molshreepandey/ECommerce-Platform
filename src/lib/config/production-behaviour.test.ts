import { afterEach, describe, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => {
  const value: Record<string, unknown> = { APP_ENV: 'production' };
  return { value };
});

vi.mock('@/lib/env', () => ({ getEnvironment: () => environment.value }));

const { isOtpDisplayedInUi } = await import('@/modules/identity/otp-sender');
const { courierSigningKey, courierWebhookSecret } =
  await import('@/modules/fulfilment/courier-secret');
const { isSimulatedGatewayAvailable } = await import('@/modules/payment/simulated-gateway');

const originalOtpSetting = process.env['OTP_DISPLAY_IN_UI'];

afterEach(() => {
  environment.value = { APP_ENV: 'production' };
  if (originalOtpSetting === undefined) delete process.env['OTP_DISPLAY_IN_UI'];
  else process.env['OTP_DISPLAY_IN_UI'] = originalOtpSetting;
});

// Wave 15 deployment readiness: production defaults that must hold without any extra setting.
describe('production behaviour', () => {
  it('hides the login OTP from the UI unless OTP_DISPLAY_IN_UI says otherwise', () => {
    delete process.env['OTP_DISPLAY_IN_UI'];
    expect(isOtpDisplayedInUi()).toBe(false);
    environment.value = { APP_ENV: 'staging' };
    expect(isOtpDisplayedInUi()).toBe(true);
  });

  it('never returns the login OTP in production, even with OTP_DISPLAY_IN_UI=true', () => {
    process.env['OTP_DISPLAY_IN_UI'] = 'true';
    expect(isOtpDisplayedInUi()).toBe(false);
    environment.value = { APP_ENV: 'staging' };
    expect(isOtpDisplayedInUi()).toBe(true);
  });

  it('turns the customer-chosen simulated payment gateway off in production only', () => {
    expect(isSimulatedGatewayAvailable()).toBe(false);
    for (const APP_ENV of ['development', 'test', 'staging']) {
      environment.value = { APP_ENV };
      expect(isSimulatedGatewayAvailable()).toBe(true);
    }
  });

  it('refuses to sign courier webhooks without COURIER_WEBHOOK_SECRET', () => {
    expect(() => courierWebhookSecret()).toThrow(/COURIER_WEBHOOK_SECRET must be set/);
    environment.value = { APP_ENV: 'production', COURIER_WEBHOOK_SECRET: 'x'.repeat(40) };
    expect(courierWebhookSecret()).toBe('x'.repeat(40));
  });

  it('gives every courier partner its own signing key, never the master secret itself (L2)', () => {
    environment.value = { APP_ENV: 'production', COURIER_WEBHOOK_SECRET: 'm'.repeat(40) };
    const demoExpress = courierSigningKey('demo_express');
    expect(demoExpress).toMatch(/^[0-9a-f]{64}$/);
    expect(courierSigningKey('demo_express')).toBe(demoExpress);
    expect(courierSigningKey('demo_surface')).not.toBe(demoExpress);
    expect(demoExpress).not.toBe('m'.repeat(40));
    environment.value = { APP_ENV: 'production', COURIER_WEBHOOK_SECRET: 'n'.repeat(40) };
    expect(courierSigningKey('demo_express')).not.toBe(demoExpress);
  });
});
