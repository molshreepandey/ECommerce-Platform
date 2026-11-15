'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { useToast } from '@/components/atoms/Toast';
import { QuantityStepper } from '@/components/molecules/QuantityStepper';
import { sendJson } from '@/lib/api-client';
import { maximumQuantityPerLine } from '@/modules/cart/cart.schema';

type AddToCartPanelProps = Readonly<{
  variantId: string | null;
  availableQuantity: number;
  productName: string;
}>;

// C20: add to cart, or Buy Now (add, then straight to checkout). The server re-checks stock either way.
export function AddToCartPanel({ variantId, availableQuantity, productName }: AddToCartPanelProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [pendingAction, setPendingAction] = useState<'add' | 'buy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maximum = Math.max(1, Math.min(maximumQuantityPerLine, availableQuantity));
  const canBuy = variantId !== null && availableQuantity > 0;

  async function addToCart(action: 'add' | 'buy') {
    if (variantId === null) return;
    setPendingAction(action);
    setError(null);
    const result = await sendJson('/api/store/cart/items', {
      body: { variantId, quantity: Math.min(quantity, maximum) },
    });
    setPendingAction(null);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    if (action === 'buy') {
      router.push('/checkout');
      return;
    }
    showToast({ title: 'Added to cart', description: productName, tone: 'success' });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-md">
      {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
      {canBuy ? (
        <QuantityStepper
          label="Quantity"
          value={Math.min(quantity, maximum)}
          maximum={maximum}
          onChange={setQuantity}
          isDisabled={pendingAction !== null}
        />
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <Button
          appearance="primary"
          size="lg"
          iconBefore="shopping-cart"
          disabled={!canBuy || pendingAction !== null}
          isLoading={pendingAction === 'add'}
          onClick={() => void addToCart('add')}
        >
          {canBuy ? 'Add to cart' : 'Out of stock'}
        </Button>
        {canBuy ? (
          <Button
            appearance="default"
            size="lg"
            disabled={pendingAction !== null}
            isLoading={pendingAction === 'buy'}
            onClick={() => void addToCart('buy')}
          >
            Buy now
          </Button>
        ) : null}
      </div>
    </div>
  );
}
