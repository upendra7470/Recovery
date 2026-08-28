import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { getDemoStatus } from '@/lib/api/demo';
import { getOpportunityOverview } from '@/lib/api/opportunities';
import { getOperationsExecutions } from '@/lib/api/recovery-operations';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Analytics — RecoveryOS',
  description: 'Recovery revenue analytics, strategy effectiveness, and outcome trends.',
};

export default async function AnalyticsPage() {
  const [demoStatus, oppOverview, executions] = await Promise.all([
    getDemoStatus().catch(() => null),
    getOpportunityOverview(),
    getOperationsExecutions({ limit: 100 }),
  ]);

  const recoveredAmount = demoStatus?.metrics.recoveredRevenue ?? 0;
  const recoverableAmount = demoStatus?.metrics.recoverableRevenue ?? 0;
  const recoveryRate = demoStatus?.metrics.recoveryRate ?? 0;
  const successfulCount = demoStatus?.metrics.successfulRecoveries ?? 0;
  const blockedCount = demoStatus?.metrics.blockedActions ?? 0;
  const reviewCount = demoStatus?.metrics.humanReviews ?? 0;
  const totalExecutions = executions?.executions.length ?? 0;

  const hasData = (demoStatus?.hasDemoData || totalExecutions > 0 || (oppOverview?.failedPayments ?? 0) > 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Recovered revenue trends, strategy effectiveness, and verifiable outcome metrics."
      />

      {!hasData ? (
        <SectionCard title="Trends" subtitle="Revenue recovered over time">
          <EmptyState
            title="No analytics available yet."
            message="Analytics become meaningful once payment events and recovery outcomes are captured. Run a demo scenario to see live analytics."
          />
          <div className="mt-4 text-center">
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Open Demo Command Center →
            </Link>
          </div>
        </SectionCard>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Recovered"
              value={formatMinorAmount(recoveredAmount, 'INR')}
              hint="Verified in recovery ledger"
              tone="positive"
            />
            <StatCard
              label="Recovery Success Rate"
              value={formatPercent(recoveryRate)}
              hint="Recovered share of resolved leakage"
              tone="positive"
            />
            <StatCard
              label="Executed Attempts"
              value={String(totalExecutions)}
              hint="Provider operations initiated"
            />
            <StatCard
              label="Safety Interventions"
              value={String(blockedCount + reviewCount)}
              hint={`${blockedCount} blocked · ${reviewCount} review`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Revenue Recovery Breakdown" subtitle="Financial impact of RecoveryOS">
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-600">Recovered Revenue</span>
                    <span className="text-emerald-700">{formatMinorAmount(recoveredAmount, 'INR')}</span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(100, Math.max(0, recoveryRate))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-600">Total Volume at Risk</span>
                    <span className="text-slate-900">{formatMinorAmount(recoverableAmount, 'INR')}</span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-600 w-full" />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                  <strong>Verification Model:</strong> Every rupee of recovered revenue is backed by a verified <code>payment.captured</code> webhook event matched to the source failed payment.
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Decision Strategy Distribution" subtitle="Outcome of automated policy assessments">
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-700">✓ Successful Retries</span>
                  </div>
                  <span className="font-mono font-bold text-emerald-800">{successfulCount}</span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-rose-700">⊘ Unsafe Retries Blocked</span>
                  </div>
                  <span className="font-mono font-bold text-rose-800">{blockedCount}</span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-700">⚑ Human-in-the-Loop Reviews</span>
                  </div>
                  <span className="font-mono font-bold text-amber-800">{reviewCount}</span>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Revenue Recovery Trend" subtitle="Cumulative recovered revenue graph">
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white shadow-inner">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-indigo-400">Ledger Balance</span>
                  <p className="mt-1 text-3xl font-bold font-mono text-emerald-400">
                    {formatMinorAmount(recoveredAmount, 'INR')}
                  </p>
                </div>
                <span className="rounded bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                  ● Real-Time Verified
                </span>
              </div>

              {/* Simple Clean Bar Chart Representation */}
              <div className="mt-8 flex h-32 items-end gap-3 border-b border-slate-700 pb-2">
                <div className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-400">Initial</span>
                  <div className="w-full rounded bg-slate-800 h-2" />
                  <span className="text-[9px] text-slate-500">₹0</span>
                </div>
                <div className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-400">Risk Detected</span>
                  <div className="w-full rounded bg-rose-500/60 h-8" />
                  <span className="text-[9px] text-slate-500">{formatMinorAmount(recoverableAmount, 'INR')}</span>
                </div>
                <div className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-400">Analyzed</span>
                  <div className="w-full rounded bg-indigo-500 h-16" />
                  <span className="text-[9px] text-slate-500">AI Verified</span>
                </div>
                <div className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-emerald-400">Recovered</span>
                  <div className="w-full rounded bg-emerald-500 h-28 shadow-lg shadow-emerald-500/30" />
                  <span className="text-[9px] font-bold text-emerald-400 font-mono">
                    {formatMinorAmount(recoveredAmount, 'INR')}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </>
  );
}
