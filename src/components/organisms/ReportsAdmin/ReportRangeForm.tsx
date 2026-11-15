import { Button } from '@/components/atoms/Button';
import { FormField } from '@/components/molecules/FormField';

// A GET form so the range lives in the URL (shareable, works without JavaScript). Days are IST.
export function ReportRangeForm({
  action,
  fromDay,
  toDay,
}: Readonly<{ action: string; fromDay: string; toDay: string }>) {
  return (
    <form
      method="get"
      action={action}
      aria-label="Date range"
      className="flex flex-wrap items-end gap-md"
    >
      <FormField label="From" name="from" type="date" defaultValue={fromDay} />
      <FormField label="To" name="to" type="date" defaultValue={toDay} />
      <Button type="submit" appearance="default" iconBefore="history">
        Show
      </Button>
    </form>
  );
}
