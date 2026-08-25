import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { SystemStatusPill } from '@/components/ui/system-status-pill';
import { getApiHealth } from '@/lib/api/status';
import {
  getDecisionsOverview,
  getOpportunityOverview,
  type CurrencyBreakdown,
} from '@/lib/api/opportunities';
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
  const [apiHealth, overview, decisions] = await Promise.all([
    getApiHealth(),
    getOpportunityOverview(),
    getDecisionsOverview(),
  ]);

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

      <div className="mt-6">
        <SectionCard
          title="Decision Engine Signals"
          subtitle={
            decisions
              ? `Deterministic assessments · engine ${decisions.engineVersion}`
              : 'Decision engine'
          }
        >
          {decisions === null ? (
            <EmptyState
              title="Decision engine unreachable."
              message="Could not load decision metrics from the API. Verify the service is running and try again."
            />
          ) : decisions.averageConfidence === null &&
            decisions.criticalOpportunities === 0 &&
            decisions.highPriorityOpportunities === 0 &&
            decisions.recommendedRetries === 0 &&
            decisions.reviewRequired === 0 ? (
            <EmptyState
              title="No decisions evaluated yet."
              message="Decisions appear when recovery cases are assessed. Open a recovery case to trigger its first evaluation."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Critical Priority"
                value={String(decisions.criticalOpportunities)}
                tone="risk"
                hint="Score 80–100 opportunities."
              />
              <StatCard
                label="High Priority"
                value={String(decisions.highPriorityOpportunities)}
                hint="Score 60–79 opportunities."
              />
              <StatCard
                label="Recommended Retries"
                value={String(decisions.recommendedRetries)}
                tone="positive"
                hint={`${decisions.reviewRequired} case${decisions.reviewRequired === 1 ? '' : 's'} flagged for review instead.`}
              />
              <StatCard
                label="Avg Confidence"
                value={
                  decisions.averageConfidence !== null
                    ? formatPercent(decisions.averageConfidence)
                    : '—'
                }
                hint="Evidence quality across stored decisions."
              />
            </div>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Advisory only — RecoveryOS does not execute payments or retries.{' '}
            <Link href="/recovery-cases" className="text-indigo-600 hover:underline">
              View recovery cases
            </Link>
            .
          </p>
        </SectionCard>
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
