import { getEnvironment } from '@/lib/env';
import { getLogger } from '@/lib/logger';

// Plan C3: how a login code reaches the customer. Only `log_otp_sender` exists: no SMS is sent, the code
// goes to the server log. A real SMS provider is another implementation of this interface.
export interface OtpSender {
  readonly key: string;
  send(input: { phone: string; code: string; challengeId: string }): Promise<void>;
}

export const logOtpSender: OtpSender = {
  key: 'log_otp_sender',
  send({ phone, code, challengeId }) {
    getLogger().info(
      // Plan C3 writes the code to the log on purpose (no SMS); `otpCode` itself stays redacted elsewhere.
      { event: 'otp_issued', challengeId, phoneEnding: phone.slice(-4), issuedCode: code },
      'login OTP issued (log_otp_sender: no SMS is sent)',
    );
    return Promise.resolve();
  },
};

// OTP_DISPLAY_IN_UI decides whether the code is also returned to the login page (staging/demo popup).
// Unset, it is on everywhere except production. Production never returns the code, whatever the
// setting says (plan C3): there it is only in the server log.
export function isOtpDisplayedInUi(): boolean {
  const environment = getEnvironment();
  if (environment.APP_ENV === 'production') return false;
  const setting = process.env['OTP_DISPLAY_IN_UI'] ?? environment.OTP_DISPLAY_IN_UI;
  return setting === undefined || setting === 'true';
}
