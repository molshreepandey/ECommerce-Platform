import {
  type DatabaseClient,
  getDatabase,
  isUniqueViolation,
  uniqueViolationConstraintName,
} from '@/lib/db';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { recordAuditEvent } from '@/modules/audit/audit.service';

import type { CustomerContext, RequestMetadata } from './access-control';
import { refusedDemoCredentialField, ReservedDemoCredentialError } from './demo-credentials';
import {
  type CustomerProfile,
  findCustomerCredentialsByEmail,
  findCustomerPasswordHash,
  findCustomerProfile,
  findCustomerStatusRow,
  insertCustomer,
  updateCustomerProfileRow,
} from './customer-account.repository';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  PhoneAlreadyRegisteredError,
  profileErrors,
  UnauthenticatedError,
} from './identity.errors';
import type { LoginInput, RegisterCustomerInput, UpdateProfileInput } from './identity.schema';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password-hasher';
import { revokeAllSessionsForSubject, revokeOtherSessionsForSubject } from './session.repository';
import { type StartedSession, startSession } from './session.service';

const unknownClient = 'unknown-client';

function toConflictError(error: unknown): unknown {
  if (!isUniqueViolation(error)) return error;
  const constraintName = uniqueViolationConstraintName(error);
  if (constraintName === 'customers_email_key') return new EmailAlreadyRegisteredError();
  if (constraintName === 'customers_phone_key') return new PhoneAlreadyRegisteredError();
  return error;
}

export async function registerCustomer(
  input: RegisterCustomerInput,
  metadata: RequestMetadata,
): Promise<{ customer: CustomerProfile; session: StartedSession }> {
  await enforceRateLimit({
    action: 'customer-register',
    identifier: metadata.clientIp ?? unknownClient,
  });
  const reservedField = refusedDemoCredentialField(input);
  if (reservedField !== null) throw new ReservedDemoCredentialError(reservedField);
  const passwordHash = await hashPassword(input.password);
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const customer = await insertCustomer(transaction, {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
      });
      await recordAuditEvent(transaction, {
        actorType: 'CUSTOMER',
        actorId: customer.id,
        action: 'customer.registered',
        entityType: 'customer',
        entityId: customer.id,
        after: { email: customer.email, fullName: customer.fullName },
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      const session = await startSession(transaction, {
        subjectType: 'CUSTOMER',
        subjectId: customer.id,
      });
      return { customer, session };
    });
  } catch (error) {
    throw toConflictError(error);
  }
}

// Unknown email, wrong password and blocked accounts all end in the same error after a hash check.
export async function loginCustomer(
  input: LoginInput,
  metadata: RequestMetadata,
): Promise<{ customerId: string; session: StartedSession }> {
  await enforceRateLimit({
    action: 'customer-login',
    identifier: `${metadata.clientIp ?? unknownClient}|${input.email}`,
  });
  const account = await findCustomerCredentialsByEmail(getDatabase(), input.email);
  if (account === null || refusedDemoCredentialField(input) !== null) {
    await verifyAgainstDummyHash(input.password);
    throw new InvalidCredentialsError();
  }
  const passwordMatches = await verifyPassword(account.passwordHash, input.password);
  if (!passwordMatches || account.status !== 'ACTIVE') throw new InvalidCredentialsError();
  const session = await startSession(getDatabase(), {
    subjectType: 'CUSTOMER',
    subjectId: account.id,
  });
  return { customerId: account.id, session };
}

export async function logoutCustomerEverywhere(
  customer: CustomerContext,
  metadata: RequestMetadata,
): Promise<number> {
  return getDatabase().$transaction(async (transaction) => {
    const revokedSessionCount = await revokeAllSessionsForSubject(transaction, {
      subjectType: 'CUSTOMER',
      subjectId: customer.customerId,
    });
    await recordAuditEvent(transaction, {
      actorType: 'CUSTOMER',
      actorId: customer.customerId,
      action: 'customer.logout_everywhere',
      entityType: 'customer',
      entityId: customer.customerId,
      // The audit sanitiser drops any key containing "session", so this key avoids the word.
      after: { revokedCount: revokedSessionCount },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    return revokedSessionCount;
  });
}

export async function getCustomerProfile(customer: CustomerContext): Promise<CustomerProfile> {
  const profile = await findCustomerProfile(getDatabase(), customer.customerId);
  if (profile === null) throw new UnauthenticatedError();
  return profile;
}

// M2: re-authentication before the phone (an OTP login key) changes, so a stolen session cannot move
// OTP access to another number. Wrong guesses share the per-account sign-in budget.
async function confirmCurrentPassword(
  customer: CustomerContext,
  currentPassword: string | undefined,
): Promise<void> {
  if (currentPassword === undefined) throw profileErrors.currentPasswordRequired();
  await enforceRateLimit({
    action: 'customer-login',
    identifier: `reauthenticate|${customer.customerId}`,
  });
  const passwordHash = await findCustomerPasswordHash(getDatabase(), customer.customerId);
  if (passwordHash === null) throw new UnauthenticatedError();
  if (!(await verifyPassword(passwordHash, currentPassword))) {
    throw profileErrors.currentPasswordIncorrect();
  }
}

export async function updateCustomerProfile(
  customer: CustomerContext,
  input: UpdateProfileInput,
  metadata: RequestMetadata,
): Promise<CustomerProfile> {
  const current = await findCustomerProfile(getDatabase(), customer.customerId);
  if (current === null) throw new UnauthenticatedError();
  const isPhoneChange = input.phone !== undefined && input.phone !== current.phone;
  if (isPhoneChange) await confirmCurrentPassword(customer, input.currentPassword);
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const before = await findCustomerProfile(transaction, customer.customerId);
      if (before === null) throw new UnauthenticatedError();
      const changes = {
        ...(input.fullName !== undefined && input.fullName !== before.fullName
          ? { fullName: input.fullName }
          : {}),
        ...(input.phone !== undefined && input.phone !== before.phone
          ? { phone: input.phone }
          : {}),
      };
      if (Object.keys(changes).length === 0) return before;
      const after = await updateCustomerProfileRow(transaction, customer.customerId, changes);
      // M2: the phone is an OTP login key, so a new phone signs out every other session.
      const endedLogins =
        'phone' in changes
          ? await revokeOtherSessionsForSubject(
              transaction,
              { subjectType: 'CUSTOMER', subjectId: customer.customerId },
              customer.sessionId,
            )
          : 0;
      await recordAuditEvent(transaction, {
        actorType: 'CUSTOMER',
        actorId: customer.customerId,
        action: 'customer.profile_updated',
        entityType: 'customer',
        entityId: customer.customerId,
        before: {
          ...('fullName' in changes ? { fullName: before.fullName } : {}),
          ...('phone' in changes ? { phone: before.phone } : {}),
        },
        after: 'phone' in changes ? { ...changes, endedLogins } : changes,
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      return after;
    });
  } catch (error) {
    throw toConflictError(error);
  }
}

// Checkout refuses a blocked customer with 403 even while an older session is still valid (plan §10A).
export async function isCustomerBlocked(
  database: DatabaseClient,
  customerId: string,
): Promise<boolean> {
  return (await findCustomerStatusRow(database, customerId))?.status !== 'ACTIVE';
}
