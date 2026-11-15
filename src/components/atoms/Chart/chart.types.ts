export type ChartSeries = Readonly<{ label: string; values: readonly number[] }>;

export type ChartProps = Readonly<{
  title: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  valueFormat?: 'count' | 'rupees';
}>;
