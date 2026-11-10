import type { AddressCardAddress } from '@/components/molecules/AddressCard';

export type AddressBookProps = Readonly<{ addresses: readonly AddressCardAddress[] }>;

export type AddressFormProps = Readonly<{
  formId: string;
  address: AddressCardAddress | null;
  isFirstAddress: boolean;
  onSaved: () => void;
  onPendingChange: (isPending: boolean) => void;
}>;
