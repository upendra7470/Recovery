import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import {
  getOperationsExecutions,
  getOperationsOverview,
  describeReconciliationLabel,
  type ExecutionStatus,
  type OperationsExecutionSummary,
} from '@/lib/api/recovery-operations';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  AUTHORIZED: 'bg-blue-50 text-blue-700',
  EXECUTING: 'bg-indigo-50 text-indigo-700',
  SUCCEEDED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
  BLOCKED: 'bg-amber-50 text-amber-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const RECON_TONE: Record<string, string> = {
  positive: 'text-emerald-700',
  neutral: 'text-slate-600',
  warn: 'text-amber-700',
  risk: 'text-rose-700',
};

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function ExecutionRow({ execution }: { execution: OperationsExecutionSummary }) {
  const recon = describeReconciliationLabel(execution.reconciliation);
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <Link
          href={`/operations/${execution.id}`}
          className="font-mono text-xs text-indigo-700 hover:underline"
        >
          {execution.id.slice(0, 8)}…
        </Link>
        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
          {execution.origin} · attempt #{execution.attempt}
        </p>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[execution.status] ?? 'bg-slate-100 text-slate-600'}`}
        >
          {execution.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">{execution.action}</td>
      <td className={`px-4 py-3 text-xs font-medium ${RECON_TONE[recon.tone]}`}>{recon.label}</td>
      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
        {formatDate(execution.completedAt)}
      </td>
      <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
        {execution.nextAttemptAt !== null ? formatDate(execution.nextAttemptAt) : '—'}
      </td>
      <td className="hidden px-4 py-3 max-w-[16rem] truncate text-xs text-slate-500 xl:table-cell" title={execution.failureReason ?? ''}>
        {execution.failureCode ?? '—'}
      </td>
    </tr>
  );
}

export default async function OperationsPage() {
  const [overview, executions] = await Promise.all([
    getOperationsOverview(),
    getOperationsExecutions({ limit: 100 }),
  ]);

  const counts = overview?.countsByStatus ?? {};
  const stat = (status: ExecutionStatus) => String(counts[status] ?? 0);

  return (
    <>
      <PageHeader
        title="Recovery Operations"
        description="Automated recovery activity: scheduled attempts, outcomes and reconciliation against webhook-confirmed recoveries."
      />

      <SectionCard
        title="Automation"
        subtitle={
          overview === null
            ? 'Unavailable'
            : overview.automationEnabled
              ? 'Enabled — scheduler running'
              : 'Disabled — deterministic analysis remains active'
        }
      >
        {overview === null ? (
          <EmptyState
            title="Operations service unreachable."
            message="Could not load automation status from the API."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stat('PENDING')}</p>
                <p className="mt-1 text-[11px] text-slate-400">{overview.dueCount} due now</p>
              </div>
              <Stat label="Executing" value={stat('EXECUTING')} />
              <Stat label="Succeeded" value={stat('SUCCEEDED')} tone="positive" />
              <Stat label="Failed" value={stat('FAILED')} tone="risk" />
              <Stat label="Blocked / Cancelled" value={String((counts['BLOCKED'] ?? 0) + (counts['CANCELLED'] ?? 0))} />
            </div>
            <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              Provider acceptance is not payment recovery — the Reconciliation column
              reflects webhook-confirmed outcomes only.
              {overview.providerConfigured ? '' : ' No execution gateway is configured.'}
            </p>
          </>
        )}
      </SectionCard>

      <div className="mt-6">
        <SectionCard title="Execution activity" subtitle="Most recent first">
          {executions === null ? (
            <EmptyState
              title="Operations service unreachable."
              message="Could not load execution history from the API."
            />
          ) : executions.executions.length === 0 ? (
            <EmptyState
              title="No automated operations yet."
              message="Scheduled executions appear here once automation produces them."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 pb-2 font-medium">Execution</th>
                    <th className="px-4 pb-2 font-medium">Status</th>
                    <th className="px-4 pb-2 font-medium">Action</th>
                    <th className="px-4 pb-2 font-medium">Reconciliation</th>
                    <th className="hidden px-4 pb-2 font-medium md:table-cell">Completed</th>
                    <th className="hidden px-4 pb-2 font-medium lg:table-cell">Next attempt</th>
                    <th className="hidden px-4 pb-2 font-medium xl:table-cell">Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.executions.map((execution) => (
                    <ExecutionRow key={execution.id} execution={execution} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'risk' }) {
  const color =
    tone === 'positive' ? 'text-emerald-600' : tone === 'risk' ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
