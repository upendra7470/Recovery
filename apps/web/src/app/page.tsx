import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { SystemStatusPill } from '@/components/ui/system-status-pill';
import { getApiHealth } from '@/lib/api/status';
import { getOpportunityOverview, type CurrencyBreakdown } from '@/lib/api/opportunities';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Overview',
};

/** Sums a per-currency breakdown; INR is the primary ledger for display. */
function primaryCurrencyTotals(currencies: CurrencyBreakdown[]): {
  atRisk: number;
  recovered: number;
  extraCurrencies: string[];
} {
  const primary = currencies.find((entry) => entry.currency === 'INR');
  const extras = currencies
    .filter((entry) => entry.currency !== 'INR')
    .map((entry) => entry.currency);
  return {
    atRisk: primary?.revenueAtRisk ?? 0,
    recovered: primary?.recoveredAmount ?? 0,
    extraCurrencies: extras,
  };
}

export default async function OverviewPage() {
  const [apiHealth, overview] = await Promise.all([getApiHealth(), getOpportunityOverview()]);

  const totals =
    overview !== null
      ? primaryCurrencyTotals(overview.currencies)
      : { atRisk: 0, recovered: 0, extraCurrencies: [] };
  const closedTotal = totals.atRisk + totals.recovered;
  const recoveryRate = closedTotal > 0 ? (totals.recovered / closedTotal) * 100 : 0;
  const liveData = overview !== null;

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
          value={formatMinorAmount(totals.atRisk, 'INR')}
          hint={
            !liveData
              ? 'Detection service unreachable.'
              : `${overview.openOpportunities} open opportunit${overview.openOpportunities === 1 ? 'y' : 'ies'} detected.`
          }
          tone="risk"
        />
        <StatCard
          label="Recoverable Revenue"
          value={formatMinorAmount(totals.atRisk, 'INR')}
          hint={
            !liveData
              ? 'Detection service unreachable.'
              : `Across ${overview.failedPayments} failed payment${overview.failedPayments === 1 ? '' : 's'}.`
          }
        />
        <StatCard
          label="Recovered Revenue"
          value={formatMinorAmount(totals.recovered, 'INR')}
          tone="positive"
          hint={
            !liveData
              ? 'Detection service unreachable.'
              : 'Verified against captured payment events.'
          }
        />
        <StatCard
          label="Recovery Rate"
          value={formatPercent(recoveryRate)}
          hint={
            !liveData || closedTotal === 0
              ? 'Measured once recovery outcomes exist.'
              : 'Recovered share of resolved opportunities.'
          }
        />
      </div>

      {totals.extraCurrencies.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Additional currencies detected:{' '}
          {totals.extraCurrencies.map((currency) => {
            const entry = overview?.currencies.find((c) => c.currency === currency);
            return `${currency} ${formatMinorAmount(entry?.revenueAtRisk ?? 0, currency)}`;
          }).join(', ')}
          . Totals above show INR only.
        </p>
      )}

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
            title="No payment health signals yet."
            message="Connect a payment account and stream webhook events to start monitoring revenue health."
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
