-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- Constraints Prisma cannot express in schema.prisma (Wave 2B identity rules).
-- Emails are stored lower-case so "Asha@x.com" and "asha@x.com" cannot become two accounts.
ALTER TABLE "customers"
    ADD CONSTRAINT "customers_email_lowercase_check" CHECK (email = lower(email));

ALTER TABLE "staff_users"
    ADD CONSTRAINT "staff_users_email_lowercase_check" CHECK (email = lower(email));

-- Indian mobile numbers: 10 digits starting with 6-9, stored without country code or spaces.
ALTER TABLE "customers"
    ADD CONSTRAINT "customers_phone_format_check" CHECK (phone ~ '^[6-9][0-9]{9}$');

ALTER TABLE "customer_addresses"
    ADD CONSTRAINT "customer_addresses_phone_format_check" CHECK (phone ~ '^[6-9][0-9]{9}$');
