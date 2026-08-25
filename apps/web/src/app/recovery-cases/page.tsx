import Link from 'next/link';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import {
  getOpportunities,
  type OpportunitySummary,
  type RecoveryOpportunityStatus,
  type RecoveryOpportunityType,
  type DecisionPriority,
} from '@/lib/api/opportunities';
import { formatMinorAmount } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Recovery Cases',
};

const TYPE_LABELS: Record<RecoveryOpportunityType, string> = {
  FAILED_PAYMENT: 'Failed Payment',
  SUBSCRIPTION_PAYMENT_FAILED: 'Subscription Failed',
  CHECKOUT_DROPOFF: 'Checkout Drop-off',
};

const STATUS_STYLES: Record<RecoveryOpportunityStatus, string> = {
  OPEN: 'bg-amber-50 text-amber-700 ring-amber-200',
  RECOVERED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  EXPIRED: 'bg-slate-100 text-slate-600 ring-slate-200',
  DISMISSED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const PRIORITY_STYLES: Record<DecisionPriority, string> = {
  CRITICAL: 'bg-rose-600 text-white',
  HIGH: 'bg-orange-100 text-orange-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-slate-100 text-slate-600',
  VERY_LOW: 'bg-slate-100 text-slate-500',
};

const ACTION_LABELS = {
  RETRY: 'Retry',
  WAIT: 'Wait',
  CUSTOMER_ACTION_REQUIRED: 'Customer Action',
  DO_NOT_RETRY: 'Do Not Retry',
  REVIEW: 'Review',
  NO_ACTION: 'No Action',
} as const;

function PriorityBadge({ priority }: { priority: DecisionPriority }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function OpportunityRow({ opportunity }: { opportunity: OpportunitySummary }) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <Link
          href={`/recovery-cases/${opportunity.id}`}
          className="text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
        >
          {TYPE_LABELS[opportunity.type] ?? opportunity.type}
        </Link>
        <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500" title={opportunity.reason}>
          {opportunity.reason}
        </p>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[opportunity.status]}`}
        >
          {opportunity.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums text-slate-900">
        {formatMinorAmount(opportunity.amountAtRisk, opportunity.currency)}
      </td>
      <td className="px-4 py-3">
        {opportunity.decision ? (
          <div className="flex items-center gap-2">
            <PriorityBadge priority={opportunity.decision.priority} />
            <span className="text-xs tabular-nums text-slate-500">
              {opportunity.decision.score}/100
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        {opportunity.decision ? (
          <span className="text-xs tabular-nums text-slate-700">
            {opportunity.decision.confidence}%
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        {opportunity.decision ? (
          <span className="text-xs font-medium text-slate-700">
            {ACTION_LABELS[opportunity.decision.recommendedAction] ??
              opportunity.decision.recommendedAction}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not evaluated</span>
        )}
      </td>
      <td className="hidden px-4 py-3 text-xs text-slate-500 xl:table-cell">
        {formatDate(opportunity.detectedAt)}
      </td>
    </tr>
  );
}

export default async function RecoveryCasesPage() {
  const data = await getOpportunities();

  return (
    <>
      <PageHeader
        title="Recovery Cases"
        description="Cases tracking revenue at risk from detection through verified recovery."
      />
      <SectionCard
        title="Cases"
        subtitle={
          data ? `${data.total} detected opportunit${data.total === 1 ? 'y' : 'ies'}` : 'Detection engine signals'
        }
      >
        {data === null ? (
          <EmptyState
            title="Detection service unreachable."
            message="Could not load recovery opportunities from the API. Verify the service is running and try again."
          />
        ) : data.opportunities.length === 0 ? (
          <EmptyState
            title="No recovery cases yet."
            message="Cases appear automatically when the detection engine finds failed payments, subscription failures or checkout drop-offs in connected payment events."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 pb-2 font-medium">Case</th>
                  <th className="px-4 pb-2 font-medium">Status</th>
                  <th className="px-4 pb-2 font-medium">Amount at Risk</th>
                  <th className="px-4 pb-2 font-medium">Priority / Score</th>
                  <th className="hidden px-4 pb-2 font-medium md:table-cell">Confidence</th>
                  <th className="hidden px-4 pb-2 font-medium lg:table-cell">Recommendation</th>
                  <th className="hidden px-4 pb-2 font-medium xl:table-cell">Detected</th>
                </tr>
              </thead>
              <tbody>
                {data.opportunities.map((opportunity) => (
                  <OpportunityRow key={opportunity.id} opportunity={opportunity} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
