import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import {
  getOpportunity,
  getOpportunityDecision,
  type DecisionPriority,
  type RecoveryOpportunityType,
} from '@/lib/api/opportunities';
import { getAIAdvice, type AIAvailableAdvice, type AIAdviceState } from '@/lib/api/ai-advice';
import { formatMinorAmount } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<RecoveryOpportunityType, string> = {
  FAILED_PAYMENT: 'Failed Payment',
  SUBSCRIPTION_PAYMENT_FAILED: 'Subscription Failed',
  CHECKOUT_DROPOFF: 'Checkout Drop-off',
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
  CUSTOMER_ACTION_REQUIRED: 'Customer Action Required',
  DO_NOT_RETRY: 'Do Not Retry',
  REVIEW: 'Review Required',
  NO_ACTION: 'No Action',
} as const;

const FACTOR_LABELS: Record<string, string> = {
  value: 'Financial value',
  recency: 'Recency',
  recoverability: 'Failure recoverability',
  retryHistory: 'Retry history',
  historicalSupport: 'Historical outcomes',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Unavailable() {
  return (
    <>
      <PageHeader
        title="Recovery Case"
        description="Detection, decision and recovery details for a single opportunity."
      />
      <SectionCard title="Unavailable">
        <EmptyState
          title="Detection service unreachable."
          message="Could not load this recovery case from the API. Verify the service is running and try again."
        />
      </SectionCard>
    </>
  );
}

export default async function RecoveryCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const opportunity = await getOpportunity(id);
  if (opportunity === null) {
    // Distinguish "API unreachable" from a genuinely unknown case so failures
    // are never silently rendered as empty content.
    if (!(await apiHealthy())) {
      return <Unavailable />;
    }
    notFound();
  }

  const [decision, aiAdvice] = await Promise.all([
    getOpportunityDecision(id),
    getAIAdvice(id),
  ]);

  return (
    <>
      <PageHeader
        title={TYPE_LABELS[opportunity.type] ?? opportunity.type}
        description={opportunity.reason}
        meta={
          <Link href="/recovery-cases" className="text-sm text-indigo-700 hover:underline">
            ← All recovery cases
          </Link>
        }
      />

      <SectionCard title="Case summary">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Amount at Risk">
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {formatMinorAmount(opportunity.amountAtRisk, opportunity.currency)}
            </span>
            <p className="mt-0.5 text-xs text-slate-400">Minor units, as reported by the provider.</p>
          </Metric>
          <Metric label="Status">
            <span className="text-lg font-semibold text-slate-900">{opportunity.status}</span>
          </Metric>
          <Metric label="Payment">
            <span className="font-mono text-sm text-slate-700">
              {opportunity.providerPaymentId ?? '—'}
            </span>
          </Metric>
          <Metric label="Order">
            <span className="font-mono text-sm text-slate-700">
              {opportunity.providerOrderId ?? '—'}
            </span>
          </Metric>
        </dl>
      </SectionCard>

      <div className="mt-6 space-y-6">
        {decision === null ? (
          <SectionCard title="Recovery Decision">
            <EmptyState
              title="Decision unavailable."
              message="The decision engine could not be reached, or this case has no stored assessment yet."
            />
          </SectionCard>
        ) : (
          <>
            <SectionCard
              title="Recovery Score"
              subtitle={`Engine ${decision.engineVersion} · evaluated ${formatDate(decision.evaluatedAt)}`}
            >
              <div className="grid gap-6 sm:grid-cols-3">
                <Metric label={`Score ${decision.score}/100`}>
                  <div className="h-2.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-indigo-600"
                      style={{ width: `${Math.min(100, Math.max(0, decision.score))}%` }}
                    />
                  </div>
                </Metric>
                <Metric label="Priority">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-sm font-semibold ${PRIORITY_STYLES[decision.priority]}`}
                  >
                    {decision.priority}
                  </span>
                </Metric>
                <Metric label={`Confidence ${decision.confidence}%`}>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Confidence in this recommendation&apos;s meaningfulness — not a success probability.
                  </p>
                </Metric>
              </div>

              <div className="mt-6 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">
                  Recommended next step
                </p>
                <p className="mt-1 text-base font-semibold text-indigo-900">
                  {ACTION_LABELS[decision.recommendedAction] ?? decision.recommendedAction}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-indigo-900/80">
                  Phase 4 is advisory only — no payment actions are executed automatically.
                </p>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">Why</p>
                  <ul className="mt-2 space-y-1.5">
                    {decision.reasons.map((reason, index) => (
                      <li key={index} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                        <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Risk</p>
                  {decision.riskFlags.length === 0 ? (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-700">
                      No blocking risk detected.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {decision.riskFlags.map((flag) => (
                        <li key={flag.flag} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                          <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-rose-400" />
                          <span>
                            <span className="font-medium text-slate-800">
                              {flag.flag.replaceAll('_', ' ').toLowerCase()}
                            </span>
                            {': '}
                            {flag.explanation}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Scoring factors"
              subtitle="Deterministic weighted contributions to the score"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 pb-2 font-medium">Factor</th>
                      <th className="px-4 pb-2 font-medium">Contribution</th>
                      <th className="px-4 pb-2 font-medium">Observed value</th>
                      <th className="px-4 pb-2 font-medium">Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decision.factors.map((factor) => (
                      <tr key={factor.name} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-4 py-2.5 text-sm font-medium text-slate-800">
                          {FACTOR_LABELS[factor.name] ?? factor.name}
                        </td>
                        <td className="px-4 py-2.5 text-sm tabular-nums text-slate-700">
                          +{factor.contribution}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                          {factor.value === null ? 'unavailable' : String(factor.value)}
                        </td>
                        <td className="max-w-md px-4 py-2.5 text-xs leading-relaxed text-slate-500">
                          {factor.explanation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <AIIntelligenceSection
              advice={aiAdvice === null ? 'unreachable' : aiAdvice.ai}
              decisionAction={decision.recommendedAction}
            />
          </>
        )}
      </div>
    </>
  );
}

function AIIntelligenceSection({
  advice,
  decisionAction,
}: {
  advice: AIAdviceState | 'unreachable';
  decisionAction: string;
}) {
  const advisoryNote =
    'AI explanations are advisory and cannot override the deterministic safety decision.';

  if (advice === 'unreachable') {
    return (
      <SectionCard title="AI Recovery Intelligence" subtitle="AI ASSISTED EXPLANATION">
        <EmptyState
          title="AI assistance is temporarily unavailable."
          message="The deterministic recovery decision remains valid."
        />
      </SectionCard>
    );
  }

  if (advice.status === 'disabled') {
    return (
      <SectionCard title="AI Recovery Intelligence" subtitle="AI ASSISTED EXPLANATION">
        <EmptyState
          title="AI assistance is disabled."
          message="Deterministic recovery analysis remains active."
        />
      </SectionCard>
    );
  }

  if (advice.status === 'unavailable') {
    return (
      <SectionCard title="AI Recovery Intelligence" subtitle="AI ASSISTED EXPLANATION">
        <EmptyState title={advice.message} message={advisoryNote} />
      </SectionCard>
    );
  }

  return <AvailableAISection advice={advice} decisionAction={decisionAction} advisoryNote={advisoryNote} />;
}

function AvailableAISection({
  advice,
  decisionAction,
  advisoryNote,
}: {
  advice: AIAvailableAdvice;
  decisionAction: string;
  advisoryNote: string;
}) {
  return (
    <SectionCard
      title="AI Recovery Intelligence"
      subtitle={`AI ASSISTED EXPLANATION · ${advice.provider}/${advice.model} · advisor ${advice.advisorVersion}`}
    >
      {advice.safetyConstrained && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          The AI response contained suggestions that conflict with the authoritative
          safety decision ({decisionAction}). The deterministic decision stands; the
          constrained suggestions are not actionable.
        </div>
      )}

      <p className="text-sm leading-relaxed text-slate-800">{advice.summary}</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Explanation</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{advice.explanation}</p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Suggested operational next step
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{advice.nextStep}</p>
        </div>
        <div>
          {advice.operatorMessage !== null && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Operator note
              </p>
              <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
                {advice.operatorMessage}
              </p>
            </>
          )}
          {advice.customerMessage !== null && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Draft customer message
              </p>
              <p className="mt-1.5 rounded-lg bg-indigo-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700 ring-1 ring-inset ring-indigo-100">
                {advice.customerMessage}{' '}
                <span className="text-[11px] text-slate-400">(AI draft — review before sending)</span>
              </p>
            </>
          )}
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            AI confidence
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            {advice.confidence}% — self-reported analysis confidence only; it does not
            alter the deterministic score or recommendation.
          </p>
        </div>
      </div>

      {(advice.warnings.length > 0 || !advice.safetyConstrained) && (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Warnings</p>
          {advice.warnings.length === 0 ? (
            <p className="mt-1.5 text-xs text-emerald-700">No warnings raised by this analysis.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {advice.warnings.map((warning, index) => (
                <li key={index} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        {advisoryNote}
      </p>
    </SectionCard>
  );
}

async function apiHealthy(): Promise<boolean> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
    const response = await fetch(`${base}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
