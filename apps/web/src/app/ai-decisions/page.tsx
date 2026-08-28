import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { getOpportunities, type OpportunitySummary } from '@/lib/api/opportunities';
import { getAIAdvice, type AIAdviceResponse } from '@/lib/api/ai-advice';
import { formatMinorAmount } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Decisions — RecoveryOS',
  description: 'AI-assisted recovery recommendations, transparent explanations, and deterministic safety policy checks.',
};

interface EvaluatedDecisionItem {
  opportunity: OpportunitySummary;
  aiAdvice: AIAdviceResponse | null;
}

export default async function AiDecisionsPage() {
  const oppsResponse = await getOpportunities();
  const opportunities = oppsResponse?.opportunities ?? [];

  // Load AI advice for all available opportunities
  const evaluatedItems: EvaluatedDecisionItem[] = await Promise.all(
    opportunities.map(async (opp) => {
      const aiAdvice = await getAIAdvice(opp.id);
      return { opportunity: opp, aiAdvice };
    })
  );

  return (
    <>
      <PageHeader
        title="AI Decisions"
        description="Explainable recovery intelligence with transparent reasoning and deterministic policy enforcement."
      />

      {evaluatedItems.length === 0 ? (
        <SectionCard title="Decision log" subtitle="AI recommendations and policy checks">
          <EmptyState
            title="No AI decisions evaluated yet."
            message="Decisions appear when recovery opportunities are detected. Run a live scenario in the Demo Command Center to generate AI decisions."
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
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-950">
            <strong>Architecture Note:</strong> AI advice is advisory context only. Deterministic safety policies govern whether recommended actions are authorized for execution.
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {evaluatedItems.map(({ opportunity, aiAdvice }) => {
              const decision = opportunity.decision;
              const advice = aiAdvice?.ai;
              const isAvailable = advice?.status === 'available';
              const availableAdvice = isAvailable ? advice : null;

              const action = decision?.recommendedAction ?? 'UNKNOWN';
              const isRetry = action === 'RETRY';
              const isDoNotRetry = action === 'DO_NOT_RETRY';

              return (
                <div
                  key={opportunity.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                          Case #{opportunity.id.slice(0, 8)}
                        </span>
                        <h3 className="text-base font-bold text-slate-900">
                          {formatMinorAmount(opportunity.amountAtRisk, opportunity.currency)}
                        </h3>
                        <p className="text-xs text-slate-500">{opportunity.reason}</p>
                      </div>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          isRetry
                            ? 'bg-emerald-100 text-emerald-800'
                            : isDoNotRetry
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {action}
                      </span>
                    </div>

                    {/* Metric Badges */}
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
                        <span className="text-[10px] text-slate-400 block">Score</span>
                        <strong className="text-slate-800 font-bold">{decision?.score ?? '—'}/100</strong>
                      </div>
                      <div className="rounded bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
                        <span className="text-[10px] text-slate-400 block">Priority</span>
                        <strong className="text-slate-800 font-bold">{decision?.priority ?? '—'}</strong>
                      </div>
                      <div className="rounded bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
                        <span className="text-[10px] text-slate-400 block">AI Confidence</span>
                        <strong className="text-slate-800 font-bold">
                          {availableAdvice ? `${availableAdvice.confidence}%` : `${decision?.confidence ?? '—'}%`}
                        </strong>
                      </div>
                    </div>

                    {/* AI Explanation / Summary */}
                    {availableAdvice && (
                      <div className="mt-3.5 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-950">
                        <p className="font-semibold text-indigo-900">{availableAdvice.summary}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-indigo-900/80">
                          {availableAdvice.explanation}
                        </p>
                        <p className="mt-2 text-[11px] text-indigo-700">
                          <strong>Next Step:</strong> {availableAdvice.nextStep}
                        </p>
                        {availableAdvice.operatorMessage && (
                          <div className="mt-2 border-t border-indigo-100 pt-1.5 text-[11px] text-indigo-800">
                            <strong>Operator Note:</strong> {availableAdvice.operatorMessage}
                          </div>
                        )}
                        {availableAdvice.customerMessage && (
                          <div className="mt-2 rounded bg-white/70 p-2 text-[11px] text-slate-700">
                            <strong>Draft Customer Message:</strong> &ldquo;{availableAdvice.customerMessage}&rdquo;
                          </div>
                        )}
                      </div>
                    )}

                    {/* Policy Guardrails */}
                    <div className="mt-3.5 text-xs">
                      <p className="font-semibold text-slate-700">Safety Policy Checks</p>
                      <div className="mt-1 space-y-1">
                        <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1 text-[11px]">
                          <span className="text-slate-600">Action Safety Eligibility</span>
                          <span className={isRetry ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                            {isRetry ? '✓ Permitted (RETRY)' : '⊘ Blocked (DO_NOT_RETRY / REVIEW)'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1 text-[11px]">
                          <span className="text-slate-600">Deterministic Confidence Gate</span>
                          <span className={(decision?.confidence ?? 0) >= 60 ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>
                            {(decision?.confidence ?? 0) >= 60 ? '✓ Above Threshold (>=60%)' : '⚑ Below Threshold (<60%)'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-3 text-right">
                    <Link
                      href={`/recovery-cases/${opportunity.id}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                    >
                      View Full Recovery Case Ledger →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
