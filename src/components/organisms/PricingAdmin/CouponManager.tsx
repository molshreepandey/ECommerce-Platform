'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { fromLocalInput, toLocalInput } from '@/lib/date-input';
import { formReader } from '@/lib/form-values';
import { formatPaise, paiseToRupeesText, rupeesTextToPaise } from '@/lib/money';
import { couponInputSchema, updateCouponSchema } from '@/modules/pricing/coupon.schema';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type CouponItem = Readonly<{
  id: string;
  code: string;
  description: string;
  discountType: 'FLAT' | 'PERCENT';
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  validFrom: string;
  validUntil: string;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  usedCount: number;
  isActive: boolean;
}>;

type Editor = { mode: 'create' } | { mode: 'edit'; coupon: CouponItem };
const formId = 'coupon-form';
const discountTypeOptions = [
  { value: 'PERCENT', label: 'Percentage off' },
  { value: 'FLAT', label: 'Flat amount off' },
] as const;

function couponStatus(coupon: CouponItem, now: number) {
  if (!coupon.isActive) return { tone: 'neutral' as const, label: 'inactive' };
  if (Date.parse(coupon.validUntil) <= now) return { tone: 'warning' as const, label: 'expired' };
  if (Date.parse(coupon.validFrom) > now) return { tone: 'info' as const, label: 'scheduled' };
  if (coupon.totalUsageLimit !== null && coupon.usedCount >= coupon.totalUsageLimit) {
    return { tone: 'warning' as const, label: 'used up' };
  }
  return { tone: 'success' as const, label: 'live' };
}

function discountLabel(coupon: CouponItem): string {
  if (coupon.discountType === 'FLAT') return `${formatPaise(coupon.discountValue)} off`;
  const cap =
    coupon.maxDiscountPaise === null ? '' : ` up to ${formatPaise(coupon.maxDiscountPaise)}`;
  return `${String(coupon.discountValue)}% off${cap}`;
}

function optionalWholeNumber(text: string): number | null | string {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function paiseOrText(text: string): number | string {
  return rupeesTextToPaise(text) ?? text;
}

export function CouponManager({
  coupons,
  canWrite,
  renderedAt,
}: Readonly<{ coupons: readonly CouponItem[]; canWrite: boolean; renderedAt: string }>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [discountType, setDiscountType] = useState<'FLAT' | 'PERCENT'>('PERCENT');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const now = Date.parse(renderedAt);

  function open(next: Editor) {
    clearFailure();
    setFieldErrors({});
    setDiscountType(next.mode === 'edit' ? next.coupon.discountType : 'PERCENT');
    setEditor(next);
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const discountText = text('discountValue');
    const fields = {
      description: text('description'),
      discountType,
      discountValue:
        discountType === 'FLAT' ? paiseOrText(discountText) : optionalWholeNumber(discountText),
      maxDiscountPaise: text('maxDiscount').trim() === '' ? null : paiseOrText(text('maxDiscount')),
      minCartPaise: text('minCart').trim() === '' ? 0 : paiseOrText(text('minCart')),
      validFrom: fromLocalInput(text('validFrom')) ?? '',
      validUntil: fromLocalInput(text('validUntil')) ?? '',
      totalUsageLimit: optionalWholeNumber(text('totalUsageLimit')),
      perCustomerLimit: optionalWholeNumber(text('perCustomerLimit')),
      firstOrderOnly: text('firstOrderOnly') === 'on',
      isActive: text('isActive') === 'on',
    };
    const parsed =
      editor?.mode === 'edit'
        ? updateCouponSchema.safeParse(fields)
        : couponInputSchema.safeParse({ ...fields, code: text('code') });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const body = {
      ...parsed.data,
      validFrom: parsed.data.validFrom.toISOString(),
      validUntil: parsed.data.validUntil.toISOString(),
    };
    const saved = await run(
      editor?.mode === 'edit'
        ? { url: `/api/admin/coupons/${editor.coupon.id}`, method: 'PUT', body }
        : { url: '/api/admin/coupons', method: 'POST', body },
      editor?.mode === 'edit' ? 'Coupon updated' : 'Coupon created',
    );
    if (saved !== null) setEditor(null);
  }

  const coupon = editor?.mode === 'edit' ? editor.coupon : null;
  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  const createButton = canWrite ? (
    <Button
      appearance="primary"
      iconBefore="plus"
      onClick={() => {
        open({ mode: 'create' });
      }}
    >
      New coupon
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-lg">
      {editor === null && failure !== null ? (
        <InlineAlert tone="danger">{failure.message}</InlineAlert>
      ) : null}
      {coupons.length === 0 ? (
        <EmptyState
          icon="ticket"
          headingLevel={2}
          title="No coupons yet"
          description="Create a coupon to offer a flat or percentage discount."
          action={createButton}
        />
      ) : (
        <>
          {createButton === null ? null : <div>{createButton}</div>}
          <ul aria-label="Coupons" className="grid grid-cols-1 gap-md lg:grid-cols-2">
            {coupons.map((item) => {
              const status = couponStatus(item, now);
              return (
                <li
                  key={item.id}
                  aria-label={item.code}
                  className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-sm">
                    <div className="flex flex-col gap-xs">
                      <Text variant="body2-medium">{item.code}</Text>
                      <Text variant="body3" tone="muted">
                        {discountLabel(item)} · min cart {formatPaise(item.minCartPaise)}
                      </Text>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  {item.description === '' ? null : (
                    <Text variant="body3" tone="subtitle">
                      {item.description}
                    </Text>
                  )}
                  <Text variant="body3" tone="muted">
                    Used {item.usedCount}
                    {item.totalUsageLimit === null ? '' : ` of ${String(item.totalUsageLimit)}`}
                    {item.perCustomerLimit === null
                      ? ''
                      : ` · ${String(item.perCustomerLimit)} per customer`}
                    {item.firstOrderOnly ? ' · first order only' : ''}
                  </Text>
                  <Text variant="body3" tone="muted">
                    {new Date(item.validFrom).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{' '}
                    –{' '}
                    {new Date(item.validUntil).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}{' '}
                    IST
                  </Text>
                  {canWrite ? (
                    <div>
                      <Button
                        size="sm"
                        iconBefore="pencil"
                        aria-label={`Edit ${item.code}`}
                        onClick={() => {
                          open({ mode: 'edit', coupon: item });
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Modal
        open={editor !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditor(null);
        }}
        title={coupon === null ? 'New coupon' : `Edit ${coupon.code}`}
        size="lg"
        footer={
          <>
            <Button
              onClick={() => {
                setEditor(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Save coupon
            </Button>
          </>
        }
      >
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void save(event)}
          className="grid grid-cols-1 gap-md md:grid-cols-2"
        >
          {coupon === null ? (
            <FormField
              label="Code"
              name="code"
              hint="Letters, digits, - and _; customers type it at checkout. It cannot change later."
              autoCapitalize="characters"
              error={errors['code']}
            />
          ) : null}
          <FormField
            label="Description"
            name="description"
            defaultValue={coupon?.description ?? ''}
            error={errors['description']}
          />
          <SelectField
            label="Discount type"
            name="discountType"
            options={discountTypeOptions}
            value={discountType}
            onValueChange={(value) => {
              setDiscountType(value === 'FLAT' ? 'FLAT' : 'PERCENT');
            }}
          />
          <FormField
            label={discountType === 'FLAT' ? 'Discount (₹)' : 'Discount (%)'}
            name="discountValue"
            inputMode="decimal"
            defaultValue={
              coupon === null
                ? ''
                : coupon.discountType === 'FLAT'
                  ? paiseToRupeesText(coupon.discountValue)
                  : String(coupon.discountValue)
            }
            error={errors['discountValue']}
          />
          <FormField
            label="Maximum discount (₹, optional)"
            name="maxDiscount"
            inputMode="decimal"
            defaultValue={
              coupon?.maxDiscountPaise == null ? '' : paiseToRupeesText(coupon.maxDiscountPaise)
            }
            error={errors['maxDiscountPaise']}
          />
          <FormField
            label="Minimum cart (₹)"
            name="minCart"
            inputMode="decimal"
            defaultValue={coupon === null ? '0' : paiseToRupeesText(coupon.minCartPaise)}
            error={errors['minCartPaise']}
          />
          <FormField
            label="Valid from"
            name="validFrom"
            type="datetime-local"
            defaultValue={
              coupon === null
                ? toLocalInput(new Date().toISOString())
                : toLocalInput(coupon.validFrom)
            }
            error={errors['validFrom']}
          />
          <FormField
            label="Valid until"
            name="validUntil"
            type="datetime-local"
            defaultValue={coupon === null ? '' : toLocalInput(coupon.validUntil)}
            error={errors['validUntil']}
          />
          <FormField
            label="Total uses (optional)"
            name="totalUsageLimit"
            inputMode="numeric"
            defaultValue={coupon?.totalUsageLimit == null ? '' : String(coupon.totalUsageLimit)}
            error={errors['totalUsageLimit']}
          />
          <FormField
            label="Uses per customer (optional)"
            name="perCustomerLimit"
            inputMode="numeric"
            defaultValue={coupon?.perCustomerLimit == null ? '' : String(coupon.perCustomerLimit)}
            error={errors['perCustomerLimit']}
          />
          <Checkbox
            name="firstOrderOnly"
            label="First order only"
            defaultChecked={coupon?.firstOrderOnly ?? false}
          />
          <Checkbox name="isActive" label="Active" defaultChecked={coupon?.isActive ?? true} />
        </form>
      </Modal>
    </div>
  );
}
