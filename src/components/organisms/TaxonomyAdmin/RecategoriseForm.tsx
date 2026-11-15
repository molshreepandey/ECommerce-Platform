'use client';

import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { SelectField } from '@/components/molecules/SelectField';
import { ActionFailure, useCatalogueAction } from '@/components/organisms/CatalogueAdmin';

export type RecategoriseSource = Readonly<{ id: string; label: string; productCount: number }>;
export type RecategoriseTarget = Readonly<{ id: string; label: string }>;

// D21: move every product on one category to an active leaf category in one change (archived products
// stay where they are). Asks for confirmation first, as a bulk change.
export function RecategoriseForm({
  sources,
  targets,
}: Readonly<{ sources: readonly RecategoriseSource[]; targets: readonly RecategoriseTarget[] }>) {
  const { run, pendingKey, failure } = useCatalogueAction();
  const [fromCategoryId, setFromCategoryId] = useState('');
  const [toCategoryId, setToCategoryId] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const source = sources.find(({ id }) => id === fromCategoryId);
  const target = targets.find(({ id }) => id === toCategoryId);

  async function move() {
    const done = await run(
      'recategorise',
      {
        url: '/api/admin/tagging/recategorise',
        method: 'POST',
        body: { fromCategoryId, toCategoryId },
      },
      'Products moved',
    );
    setIsConfirming(false);
    if (done !== null) {
      setFromCategoryId('');
      setToCategoryId('');
    }
  }

  return (
    <section
      aria-labelledby="recategorise-heading"
      className="flex flex-col gap-md rounded-default border border-lowlight bg-white p-md"
    >
      <Heading level={2} variant="heading5" id="recategorise-heading">
        Move all products between categories
      </Heading>
      <ActionFailure failure={failure} />
      <div className="grid grid-cols-1 gap-md md:grid-cols-3 md:items-end">
        <SelectField
          label="Move products from"
          name="fromCategoryId"
          options={sources.map(({ id, label, productCount }) => ({
            value: id,
            label: `${label} (${String(productCount)})`,
          }))}
          value={fromCategoryId}
          placeholder={sources.length === 0 ? 'No category has products' : 'Choose a category'}
          onValueChange={setFromCategoryId}
        />
        <SelectField
          label="To category"
          name="toCategoryId"
          options={targets
            .filter(({ id }) => id !== fromCategoryId)
            .map(({ id, label }) => ({ value: id, label }))}
          value={toCategoryId}
          placeholder="Choose an active leaf category"
          onValueChange={setToCategoryId}
        />
        <div>
          <Button
            appearance="primary"
            disabled={source === undefined || target === undefined}
            onClick={() => {
              setIsConfirming(true);
            }}
          >
            Move products
          </Button>
        </div>
      </div>
      <Text variant="body3" tone="muted">
        Archived products keep their category.
      </Text>
      <ConfirmDialog
        open={isConfirming}
        onOpenChange={setIsConfirming}
        title="Move all products?"
        description={`Every product on ${source?.label ?? ''} moves to ${target?.label ?? ''}.`}
        confirmLabel="Move products"
        isPending={pendingKey === 'recategorise'}
        onConfirm={() => void move()}
      />
    </section>
  );
}
