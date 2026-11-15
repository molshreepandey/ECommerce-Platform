import Image from 'next/image';
import { connection } from 'next/server';
import { Link } from '@/components/atoms/Link';
import { getStoreBranding } from '@/modules/merchandising/store-branding.cache';

// D52: store name, logo and primary colour from the branding setting, applied at request time without a
// deploy. The colour is validated as #rrggbb before it is saved, so it can only set the variable.
export async function StoreBrand() {
  await connection();
  const branding = await getStoreBranding();
  return (
    <>
      {branding.primaryColour === null ? null : (
        <style>{`:root{--color-primary:${branding.primaryColour};}`}</style>
      )}
      <Link
        href="/"
        appearance="plain"
        variant="body1-medium"
        aria-label={`${branding.storeName} home`}
      >
        <span className="inline-flex items-center gap-sm">
          {branding.logoUrl === null ? null : (
            <Image
              src={branding.logoUrl}
              alt=""
              width={32}
              height={32}
              className="rounded-default"
              unoptimized
            />
          )}
          {branding.storeName}
        </span>
      </Link>
    </>
  );
}
