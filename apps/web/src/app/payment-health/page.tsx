import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';

export const metadata: Metadata = {
  title: 'Payment Health',
};

export default function PaymentHealthPage() {
  return (
    <>
      <PageHeader
        title="Payment Health"
        description="Success rates, failure patterns and retry performance across connected payment accounts."
      />
      <SectionCard
        title="Connected accounts"
        subtitle="Payment provider accounts monitored by RecoveryOS"
      >
        <EmptyState
          title="No payment accounts configured."
          message="Payment account connections will be supported in a later phase. No payment credentials are stored in Phase 1."
        />
      </SectionCard>
    </>
  );
}
