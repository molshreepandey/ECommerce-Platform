export type AddressCardAddress = Readonly<{
  id: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}>;

export type AddressCardProps = Readonly<{
  address: AddressCardAddress;
  isBusy?: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}>;
