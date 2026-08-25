import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';

export const metadata: Metadata = {
  title: 'Recovery Cases',
};

export default function RecoveryCasesPage() {
  return (
    <>
      <PageHeader
        title="Recovery Cases"
        description="Cases tracking revenue at risk from detection through verified recovery."
      />
      <SectionCard title="Cases" subtitle="Detection, orchestration and verification">
        <EmptyState
          title="No recovery cases yet."
          message="Cases will be created once the risk engine and recovery orchestrator ship in later phases."
        />
      </SectionCard>
    </>
  );
}
