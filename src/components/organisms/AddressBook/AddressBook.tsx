'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { useToast } from '@/components/atoms/Toast';
import { AddressCard, type AddressCardAddress } from '@/components/molecules/AddressCard';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { sendJson } from '@/lib/api-client';
import type { AddressBookProps } from './address-book.types';
import { AddressForm } from './AddressForm';

type Editor = { mode: 'create' } | { mode: 'edit'; address: AddressCardAddress };

const addressFormId = 'address-form';

export function AddressBook({ addresses }: AddressBookProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [addressToRemove, setAddressToRemove] = useState<AddressCardAddress | null>(null);
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function finishSave() {
    const wasEditing = editor?.mode === 'edit';
    setEditor(null);
    showToast({ title: wasEditing ? 'Address updated' : 'Address added', tone: 'success' });
    router.refresh();
  }

  async function makeDefault(address: AddressCardAddress) {
    setBusyAddressId(address.id);
    setErrorMessage(null);
    const result = await sendJson(`/api/store/account/addresses/${address.id}/default`);
    setBusyAddressId(null);
    if (!result.ok) {
      setErrorMessage(result.failure.message);
      return;
    }
    showToast({ title: 'Default address changed', tone: 'success' });
    router.refresh();
  }

  async function removeAddress() {
    if (addressToRemove === null) return;
    setBusyAddressId(addressToRemove.id);
    setErrorMessage(null);
    const result = await sendJson(`/api/store/account/addresses/${addressToRemove.id}`, {
      method: 'DELETE',
    });
    setBusyAddressId(null);
    setAddressToRemove(null);
    if (!result.ok) {
      setErrorMessage(result.failure.message);
      return;
    }
    showToast({ title: 'Address removed', tone: 'success' });
    router.refresh();
  }

  const addButton = (
    <Button
      appearance="primary"
      iconBefore="plus"
      onClick={() => {
        setEditor({ mode: 'create' });
      }}
    >
      Add address
    </Button>
  );

  return (
    <div className="flex flex-col gap-lg">
      {errorMessage === null ? null : <InlineAlert tone="danger">{errorMessage}</InlineAlert>}
      {addresses.length === 0 ? (
        <EmptyState
          icon="map-pin"
          headingLevel={2}
          title="No saved addresses"
          description="Add an address to speed up checkout."
          action={addButton}
        />
      ) : (
        <>
          <div>{addButton}</div>
          <ul aria-label="Saved addresses" className="grid grid-cols-1 gap-lg md:grid-cols-2">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                isBusy={busyAddressId === address.id}
                onEdit={() => {
                  setEditor({ mode: 'edit', address });
                }}
                onSetDefault={() => void makeDefault(address)}
                onRemove={() => {
                  setAddressToRemove(address);
                }}
              />
            ))}
          </ul>
        </>
      )}
      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.mode === 'edit' ? 'Edit address' : 'Add address'}
        footer={
          <>
            <Button
              appearance="default"
              onClick={() => {
                setEditor(null);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" form={addressFormId} appearance="primary" isLoading={isSaving}>
              Save address
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <AddressForm
            key={editor.mode === 'edit' ? editor.address.id : 'new'}
            formId={addressFormId}
            address={editor.mode === 'edit' ? editor.address : null}
            isFirstAddress={addresses.length === 0}
            onSaved={finishSave}
            onPendingChange={setIsSaving}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={addressToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setAddressToRemove(null);
        }}
        title="Remove this address?"
        description={
          addressToRemove === null
            ? ''
            : `${addressToRemove.recipientName}, ${addressToRemove.addressLine1}, ${addressToRemove.city} will no longer be offered at checkout.`
        }
        confirmLabel="Remove address"
        isPending={busyAddressId !== null && busyAddressId === addressToRemove?.id}
        onConfirm={() => void removeAddress()}
      />
    </div>
  );
}
