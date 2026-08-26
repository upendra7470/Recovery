import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import {
  getOperationsExecution,
  describeReconciliationLabel,
} from '@/lib/api/recovery-operations';
import { formatMinorAmount } from '@/lib/format';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function TimelineEntry({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
      <div>
        <p className="text-xs font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{value}</p>
      </div>
    </div>
  );
}

export default async function OperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOperationsExecution(id);

  if (detail === null) {
    return (
      <>
        <PageHeader
          title="Execution detail"
          description="Audit view for one automated or manual recovery execution."
        />
        <SectionCard title="Unavailable">
          <EmptyState
            title="Execution not found or service unreachable."
            message="The deterministic recovery decision remains valid."
          />
        </SectionCard>
      </>
    );
  }

  const { execution, opportunity, decision } = detail;
  const recon = describeReconciliationLabel(execution.reconciliation);

  return (
    <>
      <PageHeader
        title={`Execution ${execution.id.slice(0, 8)}…`}
        description={`${execution.origin} · attempt #${execution.attempt} · action ${execution.action}`}
        meta={
          <Link href="/operations" className="text-sm text-indigo-700 hover:underline">
            ← Recovery operations
          </Link>
        }
      />

      <SectionCard title="Outcome reconciliation">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className={`text-sm font-semibold ${RECON_TONE_CLASS[recon.tone]}`}>{recon.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            A provider accepting a retry request is NOT payment recovery. Recovery is
            confirmed exclusively by captured payment events.
          </p>
        </div>
      </SectionCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Execution">
          <dl className="space-y-3 text-sm">
            <Row label="Status" value={execution.status} />
            <Row label="Action" value={execution.action} />
            <Row label="Origin / attempt" value={`${execution.origin} · #${execution.attempt}`} />
            <Row label="Provider" value={execution.provider ?? '—'} />
            <Row label="Failure code" value={execution.failureCode ?? '—'} />
            {execution.failureReason !== null && (
              <Row label="Failure reason" value={execution.failureReason} />
            )}
          </dl>
        </SectionCard>

        <SectionCard title="Timeline">
          <div className="space-y-4">
            <TimelineEntry label="Requested" value={formatDate(execution.requestedAt)} />
            <TimelineEntry label="Started" value={formatDate(execution.startedAt)} />
            <TimelineEntry label="Completed" value={formatDate(execution.completedAt)} />
            <TimelineEntry label="Next attempt" value={formatDate(execution.nextAttemptAt)} />
          </div>
        </SectionCard>

        <SectionCard title="Linked opportunity">
          {opportunity === null ? (
            <EmptyState title="Opportunity unavailable." message="The linked opportunity could not be loaded." />
          ) : (
            <dl className="space-y-3 text-sm">
              <Row label="Opportunity status" value={opportunity.status} />
              <Row
                label="Amount at risk"
                value={formatMinorAmount(opportunity.amountAtRisk, opportunity.currency)}
              />
              <Row label="Payment" value={opportunity.providerPaymentId ?? '—'} mono />
            </dl>
          )}
        </SectionCard>

        <SectionCard title="Authorizing decision">
          {decision === null ? (
            <EmptyState
              title="Decision unavailable."
              message="The deterministic decision that authorized this execution could not be loaded."
            />
          ) : (
            <dl className="space-y-3 text-sm">
              <Row label="Engine" value={decision.engineVersion} />
              <Row label="Score / priority" value={`${decision.score}/100 · ${decision.priority}`} />
              <Row label="Confidence" value={`${decision.confidence}%`} />
              <Row label="Recommended action" value={decision.recommendedAction} />
            </dl>
          )}
        </SectionCard>
      </div>
    </>
  );
}

const RECON_TONE_CLASS: Record<string, string> = {
  positive: 'text-emerald-700',
  neutral: 'text-slate-700',
  warn: 'text-amber-800',
  risk: 'text-rose-700',
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-right text-xs text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
