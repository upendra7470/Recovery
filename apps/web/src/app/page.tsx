import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { SystemStatusPill } from '@/components/ui/system-status-pill';
import { getApiHealth } from '@/lib/api/status';
import { getDashboardOverview } from '@/lib/api/dashboard';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Merchant Dashboard — RecoveryOS',
};

const MERCHANT_ID = '00000000-0000-4000-8000-000000000099';

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'SUCCEEDED'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'FAILED'
        ? 'bg-rose-100 text-rose-800'
        : status === 'BLOCKED'
          ? 'bg-amber-100 text-amber-800'
          : status === 'RECOVERED'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-slate-100 text-slate-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {status}
    </span>
  );
}

export default async function MerchantDashboardPage() {
  const [apiHealth, dashboard] = await Promise.all([
    getApiHealth(),
    getDashboardOverview(MERCHANT_ID).catch(() => null),
  ]);

  const connected = apiHealth.online;
  const hasData = dashboard?.hasData ?? false;

  return (
    <>
      <PageHeader
        title="Merchant Dashboard"
        description="Revenue recovery intelligence — real-time exposure, recovery performance and safety compliance."
        meta={<SystemStatusPill connected={connected} />}
      />

      {!hasData ? (
        <div className="space-y-6">
          <EmptyState
            title="No recovery data yet."
            message="Run a demo scenario or ingest payment events to populate the dashboard with live metrics."
          />
          <div className="flex justify-center gap-3">
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Launch Demo Scenario
            </Link>
            <Link
              href="/simulation"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Run Simulation
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Revenue Overview — Primary KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenue at Risk"
              value={formatMinorAmount(dashboard!.revenue.atRisk, 'INR')}
              hint={`${dashboard!.recovery.opportunities} open opportunit${dashboard!.recovery.opportunities === 1 ? 'y' : 'ies'} detected.`}
              tone="risk"
            />
            <StatCard
              label="Recoverable Revenue"
              value={formatMinorAmount(dashboard!.revenue.recoverable, 'INR')}
              hint="Conservative estimate of open opportunity amounts."
            />
            <StatCard
              label="Recovered Revenue"
              value={formatMinorAmount(dashboard!.revenue.recovered, 'INR')}
              tone="positive"
              hint="Verified against captured payment events."
            />
            <StatCard
              label="Recovery Rate"
              value={formatPercent(dashboard!.revenue.recoveryRate * 100)}
              hint={
                dashboard!.revenue.recoverable === 0
                  ? 'Measured once recovery outcomes exist.'
                  : 'Recovered share of recoverable revenue.'
              }
            />
          </div>

          {/* Recovery Pipeline & Safety */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Recovery Pipeline"
              subtitle="Execution pipeline status and outcomes"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Total Executions</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{dashboard!.recovery.executionsAttempted}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Pending</p>
                  <p className="mt-1 text-2xl font-semibold text-amber-600">{dashboard!.recovery.pending}</p>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">Succeeded</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-700">{dashboard!.recovery.succeeded}</p>
                </div>
                <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-rose-600">Failed</p>
                  <p className="mt-1 text-2xl font-semibold text-rose-700">{dashboard!.recovery.failed}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  <strong className="text-slate-800">{dashboard!.recovery.verified}</strong> opportunit{dashboard!.recovery.verified === 1 ? 'y' : 'ies'} verified recovered
                </span>
                <Link href="/recovery-cases" className="font-medium text-indigo-600 hover:underline">
                  View all →
                </Link>
              </div>
            </SectionCard>

            <SectionCard
              title="Safety & Compliance"
              subtitle="Safety gate enforcement and human review"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <div>
                      <p className="text-xs font-bold text-emerald-950">Safety Gate Active</p>
                      <p className="text-[11px] text-emerald-700">All executions authorized through policy checks</p>
                    </div>
                  </div>
                  <span className="rounded bg-emerald-200/60 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                    {dashboard!.safety.approved} APPROVED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-slate-100 bg-slate-50 p-2">
                    <span className="text-[10px] text-slate-400 block">Blocked by Policy</span>
                    <strong className="text-sm text-amber-700 font-mono">{dashboard!.safety.blocked}</strong>
                  </div>
                  <div className="rounded border border-slate-100 bg-slate-50 p-2">
                    <span className="text-[10px] text-slate-400 block">Human Review Required</span>
                    <strong className="text-sm text-indigo-700 font-mono">{dashboard!.safety.humanReview}</strong>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Governed by deterministic safety guardrails.{' '}
                <Link href="/ai-decisions" className="text-indigo-600 hover:underline">
                  View decision log
                </Link>
                .
              </p>
            </SectionCard>
          </div>

          {/* Payment Health & Activity Feed */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Payment Health"
              subtitle="Payment event outcomes from opportunity data"
            >
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-slate-100 bg-slate-50 p-2 text-center">
                    <span className="text-[10px] text-slate-400 block">Total Events</span>
                    <strong className="text-sm text-slate-900 font-mono">{dashboard!.payments.total}</strong>
                  </div>
                  <div className="rounded border border-emerald-100 bg-emerald-50 p-2 text-center">
                    <span className="text-[10px] text-emerald-600 block">Successful</span>
                    <strong className="text-sm text-emerald-700 font-mono">{dashboard!.payments.successful}</strong>
                  </div>
                  <div className="rounded border border-rose-100 bg-rose-50 p-2 text-center">
                    <span className="text-[10px] text-rose-600 block">Failed</span>
                    <strong className="text-sm text-rose-700 font-mono">{dashboard!.payments.failed}</strong>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <span className="text-xs text-slate-600">Success Rate</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatPercent(dashboard!.payments.successRate * 100)}
                  </span>
                </div>
              </div>
              <div className="pt-2 text-right">
                <Link href="/payment-health" className="text-xs font-medium text-indigo-600 hover:underline">
                  View payment health →
                </Link>
              </div>
            </SectionCard>

            <SectionCard
              title="Recent Activity"
              subtitle="Latest recoveries and opportunity detections"
            >
              {dashboard!.recentActivity.length === 0 ? (
                <EmptyState
                  title="No recent activity."
                  message="Activity appears as recovery operations run."
                />
              ) : (
                <div className="space-y-2">
                  {dashboard!.recentActivity.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="font-medium text-slate-800">{item.action}</span>
                        {item.amount !== null && item.currency !== null && (
                          <span className="text-slate-400 font-mono text-[11px]">
                            {formatMinorAmount(item.amount, item.currency)}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {new Date(item.timestamp).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                        })}
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
          </div>

          {/* Quick Links */}
          <div className="mt-6">
            <SectionCard title="Quick Actions" subtitle="Navigate to specialized dashboards">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link
                  href="/recovery-cases"
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <span className="text-lg">🔍</span>
                  Recovery Cases
                </Link>
                <Link
                  href="/ai-decisions"
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <span className="text-lg">🧠</span>
                  AI Decisions
                </Link>
                <Link
                  href="/merchant-memory"
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <span className="text-lg">📊</span>
                  Merchant Memory
                </Link>
                <Link
                  href="/recovery-modules"
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <span className="text-lg">⚙️</span>
                  Recovery Modules
                </Link>
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </>
  );
}
