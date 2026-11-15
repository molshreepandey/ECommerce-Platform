export type ProductCardProduct = Readonly<{
  slug: string;
  name: string;
  brandName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  minPricePaise: number;
  mrpPaise: number;
  inStock: boolean;
  rating: number | null;
  reviewCount: number;
}>;

export type ProductCardProps = Readonly<{ product: ProductCardProduct }>;
