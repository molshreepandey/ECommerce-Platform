import photoCredits from './catalogue-photo-credits.json' with { type: 'json' };

// Bundled images for the demo catalogue: product photographs from Wikimedia Commons in
// public/catalogue-photos/ (credited on /credits), and, for a product without a photo, the drawing in
// public/catalogue-art/ (scripts/generate-catalogue-art.ts).
//
// The demo seed stored placeholder photo URLs (picsum.photos/seed/<slug>-<n>/800/800), which show random,
// unrelated photographs. Databases already loaded keep those rows, so the storefront and admin swap exactly
// those seeded URLs for the matching product's own image when they render; nothing in the database
// changes. Any other URL (an image an admin added) is shown as it is.

export const catalogueArtProductSlugs: ReadonlySet<string> = new Set([
  'anarkali-kurta-indigo-print',
  'anarkali-kurta-rust-print',
  'anarkali-kurta-emerald-print',
  'banarasi-silk-saree',
  'floral-wrap-dress',
  'ribbed-crop-top',
  'classic-crew-tshirt',
  'oxford-formal-shirt',
  'slim-fit-stretch-jeans',
  'linen-kurta-set',
  'runner-sneaker-black',
  'runner-sneaker-white',
  'runner-sneaker-grey',
  'leather-derby-shoe',
  'canvas-slip-on',
  'strappy-flat-sandal',
  'suede-loafer',
  'trail-hiking-boot',
  'everyday-walking-shoe',
  'kolhapuri-flat',
  'voltix-nova-5g-smartphone',
  'nimbus-x1-smartphone',
  'voltix-airbuds-pro',
  'nimbus-neckband-lite',
  'voltix-65w-gan-charger',
  'nimbus-20w-fast-charger',
  'nimbus-air-14-laptop',
  'voltix-creator-16-laptop',
  'voltix-power-bank-20000',
  'nimbus-sport-earphones',
  'aloe-gentle-face-wash',
  'charcoal-deep-clean-face-wash',
  'vitamin-c-glow-face-wash',
  'hyaluronic-gel-moisturiser',
  'shea-butter-night-cream',
  'ceramide-barrier-moisturiser',
  'velvet-matte-lipstick',
  'creme-satin-lipstick',
  'tinted-lip-balm',
  'rose-water-toner',
]);

export const catalogueArtBannerKeys: ReadonlySet<string> = new Set([
  'festive',
  'electronics',
  'expired-summer',
]);

const seededProductImage =
  /^https:\/\/(?:fastly\.)?picsum\.photos\/seed\/([a-z0-9-]+)-([0-2])\/800\/800$/;
const seededBannerImage =
  /^https:\/\/(?:fastly\.)?picsum\.photos\/seed\/banner-([a-z-]+)\/1600\/500$/;

export interface CataloguePhotoCredit {
  slug: string;
  title: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  modified: string;
}

export const cataloguePhotoCredits: readonly CataloguePhotoCredit[] = photoCredits;
const photographedSlugs: ReadonlySet<string> = new Set(photoCredits.map(({ slug }) => slug));

export function productPhotoUrl(productSlug: string): string | null {
  return photographedSlugs.has(productSlug)
    ? `/catalogue-photos/products/${productSlug}.jpg`
    : null;
}

// One photograph per product: every seeded view of a photographed product shows it (the gallery drops
// repeats); a product without a photograph keeps its three drawn views.
export function productImageFor(productSlug: string, view = 0): string {
  return productPhotoUrl(productSlug) ?? productArtUrl(productSlug, view);
}

export function productArtUrl(productSlug: string, view = 0): string {
  return `/catalogue-art/products/${productSlug}-${String(view)}.svg`;
}

export function displayImageUrl(url: string): string {
  const product = seededProductImage.exec(url);
  if (product !== null) {
    const [, slug = '', view = '0'] = product;
    return catalogueArtProductSlugs.has(slug) ? productImageFor(slug, Number(view)) : url;
  }
  const banner = seededBannerImage.exec(url);
  if (banner !== null) {
    const [, key = ''] = banner;
    return catalogueArtBannerKeys.has(key) ? `/catalogue-art/banners/${key}.svg` : url;
  }
  return url;
}

// The demo product that pictures each demo category on the category pages (null: no picture, an icon).
const categoryArtProductBySlug: Readonly<Record<string, string>> = {
  apparel: 'anarkali-kurta-emerald-print',
  'womens-clothing': 'floral-wrap-dress',
  'womens-ethnic-wear': 'anarkali-kurta-rust-print',
  kurtas: 'anarkali-kurta-indigo-print',
  sarees: 'banarasi-silk-saree',
  'womens-western-wear': 'floral-wrap-dress',
  'womens-tops': 'ribbed-crop-top',
  'womens-dresses': 'floral-wrap-dress',
  'mens-clothing': 'oxford-formal-shirt',
  'mens-topwear': 'classic-crew-tshirt',
  'mens-tshirts': 'classic-crew-tshirt',
  'mens-shirts': 'oxford-formal-shirt',
  'mens-bottomwear': 'slim-fit-stretch-jeans',
  'mens-jeans': 'slim-fit-stretch-jeans',
  footwear: 'runner-sneaker-white',
  'womens-footwear': 'strappy-flat-sandal',
  'womens-casual-shoes': 'everyday-walking-shoe',
  'womens-sandals': 'strappy-flat-sandal',
  'mens-footwear': 'leather-derby-shoe',
  'mens-sneakers': 'runner-sneaker-black',
  'mens-formal-shoes': 'leather-derby-shoe',
  electronics: 'nimbus-air-14-laptop',
  'mobiles-accessories': 'voltix-nova-5g-smartphone',
  smartphones: 'nimbus-x1-smartphone',
  'mobile-accessories': 'voltix-airbuds-pro',
  chargers: 'voltix-65w-gan-charger',
  earphones: 'nimbus-sport-earphones',
  computers: 'voltix-creator-16-laptop',
  laptops: 'nimbus-air-14-laptop',
  beauty: 'velvet-matte-lipstick',
  skincare: 'hyaluronic-gel-moisturiser',
  'face-care': 'vitamin-c-glow-face-wash',
  'face-wash': 'aloe-gentle-face-wash',
  moisturisers: 'ceramide-barrier-moisturiser',
  makeup: 'creme-satin-lipstick',
  lipsticks: 'velvet-matte-lipstick',
};

export function categoryArtUrl(categorySlug: string): string | null {
  const productSlug = categoryArtProductBySlug[categorySlug];
  return productSlug === undefined ? null : productImageFor(productSlug);
}
