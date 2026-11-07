import { z } from 'zod';

export const customerIdSchema = z.uuid().brand<'CustomerId'>();
export const staffUserIdSchema = z.uuid().brand<'StaffUserId'>();
export const productTypeIdSchema = z.uuid().brand<'ProductTypeId'>();
export const productIdSchema = z.uuid().brand<'ProductId'>();
export const variantIdSchema = z.uuid().brand<'VariantId'>();
export const categoryIdSchema = z.uuid().brand<'CategoryId'>();
export const productGroupIdSchema = z.uuid().brand<'ProductGroupId'>();
export const warehouseIdSchema = z.uuid().brand<'WarehouseId'>();
export const orderIdSchema = z.uuid().brand<'OrderId'>();
export const shipmentIdSchema = z.uuid().brand<'ShipmentId'>();
export const courierPartnerIdSchema = z.uuid().brand<'CourierPartnerId'>();

export type CustomerId = z.infer<typeof customerIdSchema>;
export type StaffUserId = z.infer<typeof staffUserIdSchema>;
export type ProductTypeId = z.infer<typeof productTypeIdSchema>;
export type ProductId = z.infer<typeof productIdSchema>;
export type VariantId = z.infer<typeof variantIdSchema>;
export type CategoryId = z.infer<typeof categoryIdSchema>;
export type ProductGroupId = z.infer<typeof productGroupIdSchema>;
export type WarehouseId = z.infer<typeof warehouseIdSchema>;
export type OrderId = z.infer<typeof orderIdSchema>;
export type ShipmentId = z.infer<typeof shipmentIdSchema>;
export type CourierPartnerId = z.infer<typeof courierPartnerIdSchema>;
