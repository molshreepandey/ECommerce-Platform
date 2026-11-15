'use client';

import { useId } from 'react';
import { BarChart, DoughnutChart, LineChart } from '@/components/atoms/Chart';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Heading } from '@/components/atoms/Heading';

type DashboardChartsProps = Readonly<{
  ordersByDay: readonly { day: string; orderCount: number; salesPaise: number }[];
  ordersByStatus: readonly { label: string; orderCount: number }[];
  shipmentsByCourier: readonly { courierName: string; shipmentCount: number }[];
}>;

function ChartCard({
  title,
  isEmpty,
  children,
}: Readonly<{ title: string; isEmpty: boolean; children: React.ReactNode }>) {
  // An id from the title would contain spaces, which aria-labelledby reads as several ids.
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId}>
      <div className="flex flex-col gap-md">
        <Heading level={2} variant="heading5" id={headingId}>
          {title}
        </Heading>
        {isEmpty ? (
          <EmptyState icon="chart-column" title="No data in this range" headingLevel={2} />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

// D5: orders by day, orders by status, shipments by courier.
export function DashboardCharts({
  ordersByDay,
  ordersByStatus,
  shipmentsByCourier,
}: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-lg xl:grid-cols-2">
      <ChartCard title="Orders by day" isEmpty={ordersByDay.length === 0}>
        <LineChart
          title="Orders by day"
          labels={ordersByDay.map(({ day }) => day.slice(5))}
          series={[{ label: 'Orders', values: ordersByDay.map(({ orderCount }) => orderCount) }]}
        />
      </ChartCard>
      <ChartCard title="Sales by day" isEmpty={ordersByDay.length === 0}>
        <BarChart
          title="Sales by day (₹)"
          valueFormat="rupees"
          labels={ordersByDay.map(({ day }) => day.slice(5))}
          series={[{ label: 'Sales', values: ordersByDay.map(({ salesPaise }) => salesPaise) }]}
        />
      </ChartCard>
      <ChartCard title="Orders by status" isEmpty={ordersByStatus.length === 0}>
        <DoughnutChart
          title="Orders by status"
          labels={ordersByStatus.map(({ label }) => label)}
          series={[{ label: 'Orders', values: ordersByStatus.map(({ orderCount }) => orderCount) }]}
        />
      </ChartCard>
      <ChartCard title="Shipments by courier" isEmpty={shipmentsByCourier.length === 0}>
        <BarChart
          title="Shipments by courier"
          labels={shipmentsByCourier.map(({ courierName }) => courierName)}
          series={[
            {
              label: 'Shipments',
              values: shipmentsByCourier.map(({ shipmentCount }) => shipmentCount),
            },
          ]}
        />
      </ChartCard>
    </div>
  );
}
