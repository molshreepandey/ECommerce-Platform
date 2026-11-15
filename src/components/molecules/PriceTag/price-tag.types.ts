export type PriceTagSize = 'sm' | 'lg';

export type PriceTagProps = Readonly<{
  pricePaise: number;
  mrpPaise: number;
  size?: PriceTagSize;
  prefix?: string;
}>;
