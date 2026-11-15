'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/atoms/Button';
import { Modal } from '@/components/atoms/Modal';

// The filter panel: beside the results from the md breakpoint, in a dialog behind a "Filters" button
// on small screens (so the products come first). The same server-rendered panel is used for both.
export function FilterDrawer({
  activeCount,
  children,
}: Readonly<{ activeCount: number; children: ReactNode }>) {
  return (
    <>
      <div className="hidden md:block">{children}</div>
      <div className="md:hidden">
        <Modal
          title="Filters"
          size="sm"
          trigger={
            <Button appearance="default" iconBefore="sliders" isFullWidth>
              {activeCount === 0 ? 'Filters' : `Filters (${String(activeCount)} applied)`}
            </Button>
          }
        >
          {children}
        </Modal>
      </div>
    </>
  );
}
