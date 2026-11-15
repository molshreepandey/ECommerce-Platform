// Who may load the demo catalogue (products, categories, brands, collections, warehouses, opening stock).
// It holds no accounts, passwords, customers, orders or payments, so unlike the full demo seed it may run
// in staging, but only on an explicit opt-in naming the environment. Production is always refused.

export const catalogueSeedConfirmationVariable = 'CONFIRM_DEMO_CATALOGUE_SEED';

const environmentsWithoutConfirmation: ReadonlySet<string> = new Set(['development', 'test']);

export function catalogueSeedRefusal(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  const appEnvironment = environment['APP_ENV'];
  if (appEnvironment !== undefined && environmentsWithoutConfirmation.has(appEnvironment)) {
    return null;
  }
  if (appEnvironment === 'staging') {
    return environment[catalogueSeedConfirmationVariable] === 'staging'
      ? null
      : `Refusing to load the demo catalogue into staging without an explicit opt-in: set ` +
          `${catalogueSeedConfirmationVariable}=staging for this one command.`;
  }
  if (appEnvironment === 'production') {
    return 'Refusing: the demo catalogue is never loaded into production.';
  }
  return `Refusing to load the demo catalogue: APP_ENV is "${appEnvironment ?? '(not set)'}"; expected development, test or staging.`;
}

export function assertCatalogueSeedAllowed(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const refusal = catalogueSeedRefusal(environment);
  if (refusal !== null) throw new Error(refusal);
}
