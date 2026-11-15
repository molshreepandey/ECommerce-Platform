# Proposal: verified phone numbers for OTP login (M2) — not applied

**Status:** proposal only. No migration file exists in `prisma/migrations/` (the test harness applies
every file there automatically), and nothing has been run. Needs owner approval for the schema change and
the product behaviour below.

## Risk that remains

OTP login (`otp-login.service.ts`) signs in whichever account holds the phone number. Phone numbers are
unique but never verified, so someone can register with another person's number first; that person's OTP
login then opens the squatter's account. (The other M2 path, a stolen session changing the phone, is
fixed: TD-033.)

## Proposed change

```sql
-- prisma/migrations/<timestamp>_customer_phone_verification/migration.sql
ALTER TABLE "customers" ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6);
```

Additive and nullable: no backfill, no lock beyond a catalogue update. Rollback: `DROP COLUMN`.

Behaviour:

1. OTP **request/verify** only for customers with `phone_verified_at IS NOT NULL`; for others answer exactly
   as for an unknown number (no enumeration).
2. A signed-in customer verifies their phone from the account page with the same OTP challenge
   (`otp_challenges`, purpose `VERIFY_PHONE`), which sets `phone_verified_at`.
3. Changing the phone clears `phone_verified_at` (password re-check and other-session sign-out already in
   place).

Owner decision: existing customers (including demo customers) start unverified, so OTP login stops
working for them until they verify. For the demo, a one-off backfill for the seeded demo customers only is
an option.
