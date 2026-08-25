import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';

export const metadata: Metadata = {
  title: 'Analytics',
};

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Recovered revenue trends, strategy effectiveness and cohort insights."
      />
      <SectionCard title="Trends" subtitle="Revenue recovered over time">
        <EmptyState
          title="No analytics available yet."
          message="Analytics become meaningful once payment events and recovery outcomes are being captured."
        />
      </SectionCard>
    </>
  );
}
