import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import {
  getOpportunities,
  type OpportunitySummary,
  type RecoveryOpportunityStatus,
  type RecoveryOpportunityType,
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function OpportunityRow({ opportunity }: { opportunity: OpportunitySummary }) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-slate-900">
          {TYPE_LABELS[opportunity.type] ?? opportunity.type}
        </span>
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
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {opportunity.providerPaymentId ?? '—'}
      </td>
      <td className="hidden px-4 py-3 font-mono text-xs text-slate-500 md:table-cell">
        {opportunity.providerOrderId ?? '—'}
      </td>
      <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
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
        subtitle={data ? `${data.total} detected opportunit${data.total === 1 ? 'y' : 'ies'}` : 'Detection engine signals'}
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
                  <th className="px-4 pb-2 font-medium">Payment</th>
                  <th className="hidden px-4 pb-2 font-medium md:table-cell">Order</th>
                  <th className="hidden px-4 pb-2 font-medium lg:table-cell">Detected</th>
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
