// Plain data passed from the server pages to the client components (no Dates, no class instances).

export type WarehouseChoice = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}>;

export type StockLevelView = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseActive: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  isLowStock: boolean;
}>;

export type StockVariantView = Readonly<{
  variantId: string;
  sku: string;
  variantStatus: string;
  levels: readonly StockLevelView[];
}>;

export type StockProductView = Readonly<{
  productId: string;
  productName: string;
  productStatus: string;
  variants: readonly StockVariantView[];
}>;

export function warehouseLabel(warehouse: WarehouseChoice): string {
  return `${warehouse.code} · ${warehouse.name}${warehouse.isActive ? '' : ' (inactive)'}`;
}
