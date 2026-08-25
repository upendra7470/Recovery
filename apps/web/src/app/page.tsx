import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { SystemStatusPill } from '@/components/ui/system-status-pill';
import { getApiHealth } from '@/lib/api/status';
import { formatInr, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Overview',
};

export default async function OverviewPage() {
  const apiHealth = await getApiHealth();

  return (
    <>
      <PageHeader
        title="Overview"
        description="A real-time view of revenue exposure, recovery performance and payment health."
        meta={<SystemStatusPill connected={apiHealth.online} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue at Risk"
          value={formatInr(0)}
          hint="No connected payment events yet."
          tone="risk"
        />
        <StatCard
          label="Recoverable Revenue"
          value={formatInr(0)}
          hint="No connected payment events yet."
        />
        <StatCard
          label="Recovered Revenue"
          value={formatInr(0)}
          tone="positive"
          hint="No recovery actions have been executed."
        />
        <StatCard
          label="Recovery Rate"
          value={formatPercent(0)}
          hint="Measured once recovery outcomes exist."
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Recent Recovery Activity"
          subtitle="Executed and verified recovery actions"
        >
          <EmptyState
            title="No recovery events yet."
            message="Activity will appear here once the recovery orchestration engine is enabled in a later phase."
          />
        </SectionCard>

        <SectionCard
          title="Payment Health"
          subtitle="Live payment success and failure signals"
        >
          <EmptyState
            title="No payment events connected yet."
            message="Connect a payment account to start monitoring revenue health. Payment ingestion is not part of Phase 1."
          />
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="AI Recovery Status" subtitle="Recovery intelligence engine">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm leading-relaxed text-indigo-900">
            The intelligence engine will become available in a later phase. No AI
            recommendations are generated yet.
          </div>
        </SectionCard>
      </div>
    </>
  );
}
