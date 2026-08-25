import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';

export const metadata: Metadata = {
  title: 'AI Decisions',
};

export default function AiDecisionsPage() {
  return (
    <>
      <PageHeader
        title="AI Decisions"
        description="Recommended recovery strategies with policy checks and human oversight."
      />
      <SectionCard title="Decision log" subtitle="AI recommendations and approvals">
        <EmptyState
          title="AI decisioning is not active."
          message="The AI decision agent will recommend and justify recovery strategies in a future phase. Nothing is being decided automatically today."
        />
      </SectionCard>
    </>
  );
}
