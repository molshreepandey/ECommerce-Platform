'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { formatPaise, rupeesTextToPaise } from '@/lib/money';
import {
  createCourierPartnerSchema,
  serviceablePincodeSchema,
  updateCourierPartnerSchema,
} from '@/modules/fulfilment/courier-admin.schema';
import { CsvUploadForm } from '../AdminActions/CsvUploadForm';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type CourierPartnerItem = Readonly<{
  id: string;
  code: string;
  name: string;
  priority: number;
  supportsCod: boolean;
  isActive: boolean;
  pincodeCount: number;
}>;

export type ServiceablePincodeItem = Readonly<{
  pincode: string;
  codAvailable: boolean;
  maxCodValuePaise: number | null;
  etaDays: number;
}>;

type Editor = { mode: 'create' } | { mode: 'edit'; partner: CourierPartnerItem };
const partnerFormId = 'courier-partner-form';

function wholeNumber(text: string): number | string {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

export function CourierManager({
  partners,
  selectedPartnerId,
  pincodes,
  canWrite,
}: Readonly<{
  partners: readonly CourierPartnerItem[];
  selectedPartnerId: string | null;
  pincodes: readonly ServiceablePincodeItem[];
  canWrite: boolean;
}>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pincodeErrors, setPincodeErrors] = useState<FieldErrors>({});
  const [pincodeToRemove, setPincodeToRemove] = useState<string | null>(null);

  async function savePartner(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const fields = {
      name: text('name'),
      priority: wholeNumber(text('priority')),
      supportsCod: text('supportsCod') === 'on',
      isActive: text('isActive') === 'on',
    };
    const parsed =
      editor?.mode === 'edit'
        ? updateCourierPartnerSchema.safeParse(fields)
        : createCourierPartnerSchema.safeParse({ ...fields, code: text('code') });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      editor?.mode === 'edit'
        ? {
            url: `/api/admin/courier-partners/${editor.partner.id}`,
            method: 'PATCH',
            body: parsed.data,
          }
        : { url: '/api/admin/courier-partners', method: 'POST', body: parsed.data },
      editor?.mode === 'edit' ? 'Courier updated' : 'Courier added',
    );
    if (saved !== null) setEditor(null);
  }

  async function savePincode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedPartnerId === null) return;
    const form = event.currentTarget;
    const text = formReader(form);
    const maxCod = text('maxCod').trim();
    const parsed = serviceablePincodeSchema.safeParse({
      pincode: text('pincode').trim(),
      codAvailable: text('codAvailable') === 'on',
      maxCodValuePaise: maxCod === '' ? null : (rupeesTextToPaise(maxCod) ?? maxCod),
      etaDays: wholeNumber(text('etaDays')),
    });
    if (!parsed.success) {
      setPincodeErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setPincodeErrors({});
    const saved = await run(
      {
        url: `/api/admin/courier-partners/${selectedPartnerId}/pincodes`,
        method: 'PUT',
        body: parsed.data,
      },
      `Pincode ${parsed.data.pincode} saved`,
    );
    if (saved !== null) form.reset();
  }

  const partner = editor?.mode === 'edit' ? editor.partner : null;
  const selected = partners.find(({ id }) => id === selectedPartnerId) ?? null;

  return (
    <div className="flex flex-col gap-lg">
      {editor === null && failure !== null ? (
        <InlineAlert tone="danger">{failure.message}</InlineAlert>
      ) : null}
      {canWrite ? (
        <div>
          <Button
            appearance="primary"
            iconBefore="plus"
            onClick={() => {
              clearFailure();
              setFieldErrors({});
              setEditor({ mode: 'create' });
            }}
          >
            New courier
          </Button>
        </div>
      ) : null}
      <ul aria-label="Courier partners" className="grid grid-cols-1 gap-md lg:grid-cols-2">
        {partners.map((item) => (
          <li
            key={item.id}
            aria-label={item.name}
            className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
          >
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <div className="flex flex-col gap-xs">
                <Text variant="body2-medium">{item.name}</Text>
                <Text variant="body3" tone="muted">
                  {item.code} · demo_courier · priority {item.priority}
                </Text>
              </div>
              <div className="flex flex-wrap gap-xs">
                <Badge tone={item.isActive ? 'success' : 'warning'}>
                  {item.isActive ? 'active' : 'inactive'}
                </Badge>
                <Badge tone={item.supportsCod ? 'info' : 'neutral'}>
                  {item.supportsCod ? 'COD' : 'prepaid only'}
                </Badge>
              </div>
            </div>
            <Text variant="body3" tone="subtitle">
              {item.pincodeCount} serviceable pincodes
            </Text>
            <div className="flex flex-wrap gap-sm">
              <Link href={`/couriers?partner=${item.id}`} variant="body2">
                Pincodes
              </Link>
              {canWrite ? (
                <Button
                  size="sm"
                  iconBefore="pencil"
                  aria-label={`Edit ${item.name}`}
                  onClick={() => {
                    clearFailure();
                    setFieldErrors({});
                    setEditor({ mode: 'edit', partner: item });
                  }}
                >
                  Edit
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {selected === null ? null : (
        <section
          aria-labelledby="pincodes-heading"
          className="flex flex-col gap-md rounded-default border border-lowlight bg-white p-md"
        >
          <Text as="span" variant="body1-medium" id="pincodes-heading">
            Pincodes served by {selected.name}
          </Text>
          {canWrite ? (
            <form
              noValidate
              aria-label="Add or update a pincode"
              onSubmit={(event) => void savePincode(event)}
              className="grid grid-cols-1 items-end gap-md md:grid-cols-5"
            >
              <FormField
                label="Pincode"
                name="pincode"
                inputMode="numeric"
                maxLength={6}
                error={pincodeErrors['pincode']}
              />
              <FormField
                label="Delivery days"
                name="etaDays"
                inputMode="numeric"
                defaultValue="4"
                error={pincodeErrors['etaDays']}
              />
              <FormField
                label="COD limit (₹, optional)"
                name="maxCod"
                inputMode="decimal"
                error={pincodeErrors['maxCodValuePaise']}
              />
              <Checkbox name="codAvailable" label="COD available" defaultChecked />
              <Button type="submit" appearance="primary" isLoading={isPending}>
                Save pincode
              </Button>
            </form>
          ) : null}
          {canWrite ? (
            <CsvUploadForm
              url={`/api/admin/courier-partners/${selected.id}/pincodes/import`}
              label="Pincodes CSV"
              columns={['pincode', 'cod_available', 'max_cod_value_rupees', 'eta_days']}
            />
          ) : null}
          {pincodes.length === 0 ? (
            <Text tone="muted">No pincodes yet.</Text>
          ) : (
            <ul
              aria-label="Pincodes"
              className="grid grid-cols-1 gap-xs sm:grid-cols-2 lg:grid-cols-3"
            >
              {pincodes.map((item) => (
                <li
                  key={item.pincode}
                  className="flex items-center justify-between gap-sm rounded-default border border-strokes p-sm"
                >
                  <Text variant="body3">
                    {item.pincode} · {item.etaDays} days ·{' '}
                    {item.codAvailable
                      ? `COD${item.maxCodValuePaise === null ? '' : ` up to ${formatPaise(item.maxCodValuePaise)}`}`
                      : 'prepaid only'}
                  </Text>
                  {canWrite ? (
                    <Button
                      size="xs"
                      appearance="ghost"
                      iconBefore="trash"
                      aria-label={`Remove ${item.pincode}`}
                      onClick={() => {
                        setPincodeToRemove(item.pincode);
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ConfirmDialog
        open={pincodeToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPincodeToRemove(null);
        }}
        title={`Stop delivering to ${pincodeToRemove ?? ''}?`}
        description="Customers with this pincode can no longer check out with this courier."
        confirmLabel="Remove pincode"
        isPending={isPending}
        onConfirm={() => {
          if (pincodeToRemove === null || selectedPartnerId === null) return;
          void run(
            {
              url: `/api/admin/courier-partners/${selectedPartnerId}/pincodes`,
              method: 'DELETE',
              body: { pincode: pincodeToRemove },
            },
            `Pincode ${pincodeToRemove} removed`,
          ).then(() => {
            setPincodeToRemove(null);
          });
        }}
      />
      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={partner === null ? 'New courier' : `Edit ${partner.name}`}
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
            <Button type="submit" form={partnerFormId} appearance="primary" isLoading={isPending}>
              Save courier
            </Button>
          </>
        }
      >
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <form
          id={partnerFormId}
          noValidate
          onSubmit={(event) => void savePartner(event)}
          className="flex flex-col gap-md"
        >
          {partner === null ? (
            <FormField
              label="Code"
              name="code"
              hint="Used in the webhook URL, for example demo-express."
              error={fieldErrors['code'] ?? failure?.fieldErrors['code']}
            />
          ) : null}
          <FormField
            label="Name"
            name="name"
            defaultValue={partner?.name ?? ''}
            error={fieldErrors['name']}
          />
          <FormField
            label="Priority"
            name="priority"
            inputMode="numeric"
            hint="Lower numbers are chosen first at checkout."
            defaultValue={partner === null ? '10' : String(partner.priority)}
            error={fieldErrors['priority']}
          />
          <Checkbox
            name="supportsCod"
            label="Supports Cash on Delivery"
            defaultChecked={partner?.supportsCod ?? true}
          />
          <Checkbox name="isActive" label="Active" defaultChecked={partner?.isActive ?? true} />
        </form>
      </Modal>
    </div>
  );
}
