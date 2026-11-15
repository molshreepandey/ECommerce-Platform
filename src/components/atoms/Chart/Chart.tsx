'use client';

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJs,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { useTheme } from '@/theme';
import type { ChartProps } from './chart.types';

ChartJs.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
);

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function usePalette(): string[] {
  const { tokens } = useTheme();
  return [
    tokens.primary,
    tokens.statusGreen,
    tokens.statusYellow,
    tokens.statusRed,
    tokens.accentBlue,
    tokens.statusOrange,
    tokens.highlight1,
    tokens.grey,
  ];
}

// Values in paise are drawn in rupees; the canvas has a text alternative (the title and a summary table
// is shown next to every chart on the page).
function scaled(values: readonly number[], valueFormat: ChartProps['valueFormat']): number[] {
  return values.map((value) => (valueFormat === 'rupees' ? value / 100 : value));
}

function tickFormatter(valueFormat: ChartProps['valueFormat']) {
  return (value: string | number) =>
    valueFormat === 'rupees' ? rupeeFormatter.format(Number(value)) : String(value);
}

export function LineChart({ title, labels, series, valueFormat = 'count' }: ChartProps) {
  const palette = usePalette();
  return (
    <div className="relative h-64 w-full">
      <Line
        aria-label={title}
        role="img"
        data={{
          labels: [...labels],
          datasets: series.map((item, index) => ({
            label: item.label,
            data: scaled(item.values, valueFormat),
            borderColor: palette[index % palette.length],
            backgroundColor: palette[index % palette.length],
            tension: 0.25,
          })),
        }}
        options={{
          maintainAspectRatio: false,
          plugins: { legend: { display: series.length > 1 } },
          scales: {
            y: { beginAtZero: true, ticks: { callback: tickFormatter(valueFormat), precision: 0 } },
          },
        }}
      />
    </div>
  );
}

export function BarChart({ title, labels, series, valueFormat = 'count' }: ChartProps) {
  const palette = usePalette();
  return (
    <div className="relative h-64 w-full">
      <Bar
        aria-label={title}
        role="img"
        data={{
          labels: [...labels],
          datasets: series.map((item, index) => ({
            label: item.label,
            data: scaled(item.values, valueFormat),
            backgroundColor: palette[index % palette.length],
          })),
        }}
        options={{
          maintainAspectRatio: false,
          plugins: { legend: { display: series.length > 1 } },
          scales: {
            y: { beginAtZero: true, ticks: { callback: tickFormatter(valueFormat), precision: 0 } },
          },
        }}
      />
    </div>
  );
}

export function DoughnutChart({ title, labels, series }: ChartProps) {
  const palette = usePalette();
  const [first] = series;
  return (
    <div className="relative h-64 w-full">
      <Doughnut
        aria-label={title}
        role="img"
        data={{
          labels: [...labels],
          datasets: [
            {
              label: first?.label ?? title,
              data: [...(first?.values ?? [])],
              backgroundColor: labels.map((_label, index) => palette[index % palette.length] ?? ''),
            },
          ],
        }}
        options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
      />
    </div>
  );
}
