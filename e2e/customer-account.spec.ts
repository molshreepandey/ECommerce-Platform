import { randomInt } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  expectNoHorizontalOverflow,
  expectSignInRejected,
  signInThroughForm,
  visibleField,
  watchPageProblems,
} from './support/auth';
import { storeOrigin } from './support/page-checks';

function uniqueCustomer(projectName: string) {
  const suffix = `${projectName}.${Date.now()}.${randomInt(1_000_000)}`;
  return {
    fullName: 'Ananya Kulkarni',
    email: `e2e.${suffix}@example.test`,
    phone: `9${String(randomInt(100_000_000, 999_999_999))}`,
    password: 'E2e-Password-2026',
  };
}

test('a customer registers, edits the profile, manages addresses and signs out and in again', async ({
  page,
}, testInfo) => {
  const problems = watchPageProblems(page);
  const customer = uniqueCustomer(testInfo.project.name);

  await page.goto(`${storeOrigin}/account`);
  await expect(page).toHaveURL(`${storeOrigin}/login?next=%2Faccount`);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Create an account' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await visibleField(page, 'Full name').fill(customer.fullName);
  await visibleField(page, 'Email').fill(customer.email);
  await visibleField(page, 'Mobile number').fill(customer.phone);
  await visibleField(page, 'Password').fill(customer.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(`${storeOrigin}/account`);
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  await expect(page.getByText(customer.email)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await visibleField(page, 'Full name').fill('Ananya K. Kulkarni');
  await page.getByRole('button', { name: 'Save profile' }).click();
  // Radix also announces the toast in a short-lived screen-reader element, so look inside the region.
  await expect(
    page.getByRole('region', { name: /Notifications/ }).getByText('Profile saved', { exact: true }),
  ).toBeVisible();
  await expect(visibleField(page, 'Full name')).toHaveValue('Ananya K. Kulkarni');

  await page.getByRole('link', { name: 'Manage addresses' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'No saved addresses' })).toBeVisible();

  const addAddress = async (line1: string, makeDefault: boolean) => {
    await page.getByRole('button', { name: 'Add address' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add address' });
    await dialog.getByLabel('Recipient name').fill('Ananya Kulkarni');
    await dialog.getByLabel('Mobile number').fill('9876505000');
    await dialog.getByLabel('Address line 1').fill(line1);
    await dialog.getByLabel('City').fill('Pune');
    await dialog.getByLabel('State').fill('Maharashtra');
    await dialog.getByLabel('Pincode').fill('411001');
    if (makeDefault)
      await dialog.getByRole('checkbox', { name: 'Make this my default address' }).check();
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(dialog).toBeHidden();
  };

  await addAddress('12 FC Road', false);
  const savedAddresses = page.getByRole('list', { name: 'Saved addresses' });
  const firstCard = savedAddresses.getByRole('article').filter({ hasText: '12 FC Road' });
  await expect(firstCard.getByText('Default', { exact: true })).toBeVisible();

  await addAddress('34 JM Road', false);
  const secondCard = savedAddresses.getByRole('article').filter({ hasText: '34 JM Road' });
  await expect(secondCard).toBeVisible();
  await expect(secondCard.getByText('Default', { exact: true })).toHaveCount(0);

  await secondCard.getByRole('button', { name: 'Make default' }).click();
  await expect(secondCard.getByText('Default', { exact: true })).toBeVisible();
  await expect(firstCard.getByText('Default', { exact: true })).toHaveCount(0);

  await secondCard.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit address' });
  await editDialog.getByLabel('Landmark (optional)').fill('Near the bakery');
  await editDialog.getByRole('button', { name: 'Save address' }).click();
  await expect(editDialog).toBeHidden();
  await expect(secondCard.getByText('Near Near the bakery')).toBeVisible();

  await firstCard.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove this address?' });
  await confirm.getByRole('button', { name: 'Remove address' }).click();
  await expect(firstCard).toHaveCount(0);
  await expect(savedAddresses.getByRole('article')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'Your account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${storeOrigin}/`);

  await page.goto(`${storeOrigin}/account/addresses`);
  await expect(page).toHaveURL(`${storeOrigin}/login?next=%2Faccount%2Faddresses`);
  await signInThroughForm(page, customer.email, 'Wrong-Password-1');
  await expectSignInRejected(page);
  await signInThroughForm(page, customer.email, customer.password);
  await expect(page).toHaveURL(`${storeOrigin}/account/addresses`);
  await expect(savedAddresses.getByRole('article')).toHaveCount(1);

  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('registration errors are announced next to each field', async ({ page }) => {
  const problems = watchPageProblems(page);
  await page.goto(`${storeOrigin}/register`);
  await visibleField(page, 'Mobile number').fill('12345');
  await page.getByRole('button', { name: 'Create account' }).click();

  const phone = visibleField(page, 'Mobile number');
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAccessibleDescription(
    /10 digits, without \+91 Enter a 10-digit mobile number starting with 6, 7, 8 or 9/,
  );
  await expect(visibleField(page, 'Email')).toHaveAttribute('aria-invalid', 'true');
  await expect(visibleField(page, 'Full name')).toHaveAttribute('aria-invalid', 'true');
  expect(problems.uncaughtPageErrors).toEqual([]);
  expect(problems.contentSecurityPolicyViolations).toEqual([]);
});

test('the password can be shown and hidden', async ({ page }) => {
  await page.goto(`${storeOrigin}/login`);
  const password = visibleField(page, 'Password');
  await password.fill('secret-value');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});
