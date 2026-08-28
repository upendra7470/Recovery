import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { SystemStatusPill } from '@/components/ui/system-status-pill';
import { getApiHealth } from '@/lib/api/status';
import { getDemoStatus } from '@/lib/api/demo';
import { getOperationsExecutions } from '@/lib/api/recovery-operations';
import {
  getDecisionsOverview,
  getOpportunityOverview,
  type CurrencyBreakdown,
} from '@/lib/api/opportunities';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Overview — RecoveryOS',
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
  const [apiHealth, overview, decisions, operations, demoStatus] = await Promise.all([
    getApiHealth(),
    getOpportunityOverview(),
    getDecisionsOverview(),
    getOperationsExecutions({ limit: 5 }),
    getDemoStatus().catch(() => null),
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

      {/* Live Demo Quick Launcher Banner */}
      <div className="mb-6 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 p-4 text-white shadow-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-mono text-xs uppercase tracking-wider text-indigo-300 font-semibold">
                Live Demo Command Center Ready
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-slate-100">
              Run interactive synthetic recovery scenarios with end-to-end telemetry and verification.
            </p>
          </div>
          <Link
            href="/demo"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow transition-all hover:bg-indigo-400"
          >
            Launch Command Center →
          </Link>
        </div>
      </div>

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
              message="Decisions appear when recovery cases are assessed. Run a demo scenario or ingest payment events to trigger evaluation."
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
          <p className="mt-4 text-xs text-slate-500">
            Governed by deterministic safety guardrails.{' '}
            <Link href="/recovery-cases" className="text-indigo-600 hover:underline">
              View all recovery cases
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
          {operations === null || operations.executions.length === 0 ? (
            <EmptyState
              title="No recovery executions yet."
              message="Executions appear here once automated or demo recovery operations run."
            />
          ) : (
            <div className="space-y-2.5">
              {operations.executions.slice(0, 4).map((exec) => (
                <div
                  key={exec.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        exec.status === 'SUCCEEDED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : exec.status === 'BLOCKED'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {exec.status}
                    </span>
                    <span className="font-medium text-slate-800">{exec.action}</span>
                    <span className="text-slate-400">· attempt #{exec.attempt}</span>
                  </div>
                  <span className="font-mono text-[11px] text-indigo-700">
                    {exec.id.slice(0, 8)}...
                  </span>
                </div>
              ))}
              <div className="pt-1 text-right">
                <Link href="/operations" className="text-xs font-medium text-indigo-600 hover:underline">
                  View full operations feed →
                </Link>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Payment Health"
          subtitle="Provider connectivity & failure signals"
        >
          {demoStatus?.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">DEMO RAZORPAY ACCOUNT</p>
                    <p className="text-[11px] text-emerald-700">Synthetic account · Test environment</p>
                  </div>
                </div>
                <span className="rounded bg-emerald-200/60 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                  HEALTHY
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-100 bg-slate-50 p-2 text-slate-600">
                  <span className="text-[10px] text-slate-400 block">Synthetic Ingested</span>
                  <strong className="text-sm text-slate-900 font-mono">
                    {demoStatus.counts.paymentEvents} events
                  </strong>
                </div>
                <div className="rounded border border-slate-100 bg-slate-50 p-2 text-slate-600">
                  <span className="text-[10px] text-slate-400 block">Recovered</span>
                  <strong className="text-sm text-emerald-700 font-mono">
                    {formatMinorAmount(demoStatus.metrics.recoveredRevenue, 'INR')}
                  </strong>
                </div>
              </div>
              <div className="pt-1 text-right">
                <Link href="/payment-health" className="text-xs font-medium text-indigo-600 hover:underline">
                  View payment health dashboard →
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No payment accounts configured."
              message="Connect a payment account or enable Demo Mode to stream payment health signals."
            />
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="AI Recovery Status" subtitle="Recovery intelligence & safety policy engine">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm leading-relaxed text-indigo-950">
            <div className="flex items-center gap-2 font-semibold text-indigo-900">
              <span className="h-2 w-2 rounded-full bg-indigo-600" />
              AI Recovery Intelligence Active (Phase 11.2)
            </div>
            <p className="mt-1 text-xs text-indigo-900/80">
              Deterministic decision engine is coupled with explainable AI advisory intelligence. Every recovery recommendation undergoes rigorous 5-point safety policy checks before execution authorization.
            </p>
            <div className="mt-3 flex gap-3 text-xs font-medium">
              <Link href="/ai-decisions" className="text-indigo-700 hover:underline">
                View AI Decision Log →
              </Link>
              <Link href="/demo" className="text-indigo-700 hover:underline">
                Test in Live Demo →
              </Link>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
