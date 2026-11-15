'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { RadioGroup } from '@/components/atoms/RadioGroup';
import { useToast } from '@/components/atoms/Toast';
import { FormField } from '@/components/molecules/FormField';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';

const formId = 'write-review-form';
const ratingOptions = [5, 4, 3, 2, 1].map((rating) => ({
  value: String(rating),
  label: `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`,
  description: `${String(rating)} out of 5`,
}));

export function WriteReviewButton({
  orderItemId,
  productName,
}: Readonly<{ orderItemId: string; productName: string }>) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating === null) {
      setError('Choose a rating.');
      return;
    }
    const read = formReader(event.currentTarget);
    setIsPending(true);
    const result = await sendJson('/api/store/reviews', {
      body: { orderItemId, rating: Number(rating), title: read('title'), body: read('body') },
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setIsOpen(false);
    showToast({ title: 'Thank you for your review', tone: 'success' });
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        iconBefore="star"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Write a review
      </Button>
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title={`Review ${productName}`}
        footer={
          <>
            <Button
              onClick={() => {
                setIsOpen(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Submit review
            </Button>
          </>
        }
      >
        {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-md"
        >
          <RadioGroup
            name="rating"
            label="Your rating"
            options={ratingOptions}
            value={rating}
            onValueChange={setRating}
          />
          <FormField label="Title (optional)" name="title" maxLength={100} />
          <FormField label="Review (optional)" name="body" maxLength={2000} />
        </form>
      </Modal>
    </>
  );
}
