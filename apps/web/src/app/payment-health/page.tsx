import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { getDemoStatus } from '@/lib/api/demo';
import { getOpportunityOverview } from '@/lib/api/opportunities';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment Health — RecoveryOS',
  description: 'Payment gateway health, failure patterns, and recovery effectiveness metrics.',
};

export default async function PaymentHealthPage() {
  const [demoStatus, overview] = await Promise.all([
    getDemoStatus().catch(() => null),
    getOpportunityOverview(),
  ]);

  const recoveredAmount = demoStatus?.metrics.recoveredRevenue ?? 0;
  const recoverableAmount = demoStatus?.metrics.recoverableRevenue ?? 0;
  const recoveryRate = demoStatus?.metrics.recoveryRate ?? 0;
  const totalEvents = (demoStatus?.counts.paymentEvents ?? 0) + 54; // Baseline synthetic stream
  const failedEvents = (overview?.failedPayments ?? 0) + 3;
  const failureRate = totalEvents > 0 ? (failedEvents / totalEvents) * 100 : 5.6;

  return (
    <>
      <PageHeader
        title="Payment Health"
        description="Gateway connectivity health, failure telemetry patterns, and recovery success metrics."
      />

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
        <strong>DEMO MODE NOTICE:</strong> The payment account below is a <strong>SYNTHETIC DEMO ACCOUNT</strong> created for test demonstration. No live credentials or production transaction networks are connected.
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Account Status"
          value="Healthy"
          hint="Synthetic gateway responding within normal latency"
          tone="positive"
        />
        <StatCard
          label="Synthetic Transactions"
          value={String(totalEvents)}
          hint="Simulated checkout events"
        />
        <StatCard
          label="Failure Rate"
          value={formatPercent(failureRate, 1)}
          hint="Temporary vs permanent declines"
          tone={failureRate > 10 ? 'risk' : 'neutral'}
        />
        <StatCard
          label="Recovery Success Rate"
          value={formatPercent(recoveryRate)}
          hint="Verified recoveries against failures"
          tone="positive"
        />
      </div>

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Monitored Payment Accounts"
          subtitle="Provider gateways configured in RecoveryOS"
        >
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-3 w-3 items-center justify-center">
                    <span className="absolute h-3 w-3 animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">DEMO RAZORPAY ACCOUNT (SYNTHETIC)</h3>
                    <p className="text-xs text-slate-500">Provider: Razorpay · Environment: Test / Demo</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                    Synthetic Demo
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Active
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="text-xs text-slate-400">Primary Currency</span>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">INR (₹)</p>
              </div>
              <div>
                <span className="text-xs text-slate-400">Common Failure Reason</span>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">Transient payment failure (GATEWAY_ERROR)</p>
              </div>
              <div>
                <span className="text-xs text-slate-400">Recovered Volume</span>
                <p className="mt-0.5 text-sm font-semibold text-emerald-700">
                  {formatMinorAmount(recoveredAmount, 'INR')}{' '}
                  <span className="text-xs font-normal text-slate-400">/ {formatMinorAmount(recoverableAmount, 'INR')}</span>
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-400">Target Adapter</span>
                <p className="mt-0.5 font-mono text-xs text-slate-700">DemoRetryAdapter (Safe)</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Failure & Recovery Insights"
          subtitle="Observed patterns across synthetic traffic"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-bold text-slate-700">Transient Bank Declines</span>
              <p className="mt-1 text-xs text-slate-500">
                Network timeouts and issuer gateway hiccups. Automatically assessed as highly recoverable via timed retry.
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                <span className="text-slate-400">Success Probability</span>
                <strong className="text-emerald-600 font-bold">&gt; 85%</strong>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-bold text-slate-700">Expired Cards & Instruments</span>
              <p className="mt-1 text-xs text-slate-500">
                Permanent payment method errors. Safety gate strictly halts retries to prevent customer churn and decline fees.
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                <span className="text-slate-400">Action</span>
                <strong className="text-rose-600 font-bold">DO NOT RETRY</strong>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs font-bold text-slate-700">Ambiguous State Ingestion</span>
              <p className="mt-1 text-xs text-slate-500">
                Unknown gateway error codes. System defers to operator review to avoid double charging customers.
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                <span className="text-slate-400">Action</span>
                <strong className="text-amber-600 font-bold">HUMAN REVIEW</strong>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Link
              href="/demo"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              Test these patterns in Demo Command Center →
            </Link>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
