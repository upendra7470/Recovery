import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { getMerchantMemoryOverview } from '@/lib/api/merchant-memory';
import { formatMinorAmount, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Merchant Memory — RecoveryOS',
  description: 'Adaptive merchant-specific historical recovery evidence and strategy effectiveness.',
};

function ConfidenceBadge({ level }: { level: 'NO_DATA' | 'LOW' | 'SUFFICIENT' }) {
  const colors = {
    NO_DATA: 'bg-slate-100 text-slate-600',
    LOW: 'bg-amber-100 text-amber-700',
    SUFFICIENT: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors[level]}`}>
      {level === 'NO_DATA' ? 'No Data' : level === 'LOW' ? 'Low Confidence' : 'Sufficient Data'}
    </span>
  );
}

function StrategyRow({ strategy }: { strategy: { strategy: string; failureType: string; attempts: number; successes: number; successRate: number; totalAmountRecovered: number; effectivenessScore: number; confidence: number } }) {
  const tone = strategy.successRate >= 0.6 ? 'emerald' : strategy.successRate >= 0.3 ? 'amber' : 'rose';
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-${tone}-50 text-${tone}-700`}>
          <span className="text-xs font-bold">{strategy.strategy.slice(0, 2)}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{strategy.strategy}</p>
          <p className="text-xs text-slate-500">{strategy.failureType} · {strategy.attempts} attempts</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-slate-900">{(strategy.successRate * 100).toFixed(0)}%</p>
        <p className="text-[10px] text-slate-500">Score: {strategy.effectivenessScore.toFixed(1)}</p>
      </div>
    </div>
  );
}

export default async function MerchantMemoryPage() {
  let overview: Awaited<ReturnType<typeof getMerchantMemoryOverview>> | null = null;
  let error = false;

  try {
    overview = await getMerchantMemoryOverview();
  } catch {
    error = true;
  }

  const hasData = overview !== null && overview.totalOutcomes > 0;

  return (
    <>
      <PageHeader
        title="Merchant Memory"
        description="Adaptive historical recovery evidence. Strategy effectiveness learned from verified outcomes."
      />

      {error ? (
        <SectionCard title="Merchant Memory" subtitle="Historical recovery evidence">
          <EmptyState
            title="Unable to load merchant memory."
            message="The merchant memory service may not be available. Ensure the API server is running."
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
      ) : !hasData ? (
        <SectionCard title="Merchant Memory" subtitle="Historical recovery evidence">
          <EmptyState
            title="No memory data yet."
            message="Merchant memory accumulates as recovery outcomes are verified. Run a demo scenario to seed initial memory."
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
          {/* Overview Stats */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Outcomes"
              value={String(overview!.totalOutcomes)}
              hint="Verified recovery outcomes"
            />
            <StatCard
              label="Recovered Amount"
              value={formatMinorAmount(overview!.totalAmountRecovered, 'INR')}
              hint="Revenue recovered from memory"
              tone="positive"
            />
            <StatCard
              label="Recovery Rate"
              value={formatPercent(overview!.recoveryRate)}
              hint="Success rate across all strategies"
              tone={overview!.recoveryRate >= 0.5 ? 'positive' : 'neutral'}
            />
            <StatCard
              label="Confidence Level"
              value={overview!.confidence}
              hint={`${overview!.totalOutcomes} samples collected`}
            />
          </div>

          {/* Best Strategy & Confidence */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Best Strategy" subtitle="Highest effectiveness score from verified outcomes">
              {overview!.bestStrategy !== null ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
                    <div>
                      <p className="text-lg font-bold text-emerald-700">{overview!.bestStrategy}</p>
                      <p className="text-xs text-emerald-600">Effectiveness Score: {overview!.bestStrategySuccessRate.toFixed(1)}</p>
                    </div>
                    <ConfidenceBadge level={overview!.confidence} />
                  </div>
                  <p className="text-xs text-slate-600">
                    This strategy has the highest effectiveness score based on verified recovery outcomes.
                    Effectiveness combines success rate, recovery amount, and sample size confidence.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
                  <p className="text-sm text-slate-500">No strategy has sufficient data yet.</p>
                  <p className="mt-1 text-xs text-slate-400">Run more demo scenarios to build memory.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Data Confidence" subtitle="Quality of merchant memory evidence">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ConfidenceBadge level={overview!.confidence} />
                  <span className="text-sm text-slate-600">
                    {overview!.confidence === 'SUFFICIENT'
                      ? '20+ verified outcomes — memory is statistically reliable.'
                      : overview!.confidence === 'LOW'
                        ? '1–19 verified outcomes — memory is growing but not yet reliable.'
                        : 'No verified outcomes yet — memory is empty.'}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
                  <strong>How confidence works:</strong> Merchant memory confidence is based on the number of verified recovery outcomes.
                  At 20+ outcomes, the system has sufficient statistical power to reliably inform AI decisions.
                  Below that, memory is still useful but should be treated as directional evidence.
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Strategy Effectiveness */}
          <SectionCard title="Strategy Effectiveness" subtitle="Performance of each recovery strategy from verified outcomes">
            <div className="space-y-2">
              {overview!.strategies
                .filter((s) => s.sampleCount > 0)
                .sort((a, b) => b.effectivenessScore - a.effectivenessScore)
                .map((s) => (
                  <StrategyRow key={`${s.strategy}-${s.failureType}`} strategy={s} />
                ))}
            </div>
            {overview!.strategies.filter((s) => s.sampleCount > 0).length === 0 && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
                <p className="text-sm text-slate-500">No strategy data yet.</p>
                <p className="mt-1 text-xs text-slate-400">Run demo scenarios to see strategy effectiveness.</p>
              </div>
            )}
          </SectionCard>

          {/* Failure Patterns */}
          <SectionCard title="Failure Patterns" subtitle="Recovery performance by failure type">
            <div className="space-y-2">
              {overview!.failurePatterns.map((fp) => (
                <div key={fp.failureType} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{fp.failureType}</p>
                    <p className="text-xs text-slate-500">{fp.attempts} attempts · {fp.successes} recovered</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{(fp.recoveryRate * 100).toFixed(0)}%</p>
                    {fp.bestStrategy !== null && (
                      <p className="text-[10px] text-emerald-600">Best: {fp.bestStrategy}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {overview!.failurePatterns.length === 0 && (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
                <p className="text-sm text-slate-500">No failure patterns recorded yet.</p>
                <p className="mt-1 text-xs text-slate-400">Memory will populate as outcomes are verified.</p>
              </div>
            )}
          </SectionCard>

          {/* How It Works */}
          <SectionCard title="How Merchant Memory Works" subtitle="Evidence-based strategy learning">
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white shadow-inner">
              <div className="space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">1</span>
                  <div>
                    <p className="font-semibold text-white">Outcome Verification</p>
                    <p className="text-slate-400 text-xs">When a recovery execution succeeds or fails, the outcome is verified via webhook-confirmed payment events.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">2</span>
                  <div>
                    <p className="font-semibold text-white">Memory Update</p>
                    <p className="text-slate-400 text-xs">Verified outcomes update the merchant strategy memory — success rates, recovery amounts, and effectiveness scores are recalculated.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">3</span>
                  <div>
                    <p className="font-semibold text-white">AI Decision Context</p>
                    <p className="text-slate-400 text-xs">The AI advisor uses merchant memory as context when generating recommendations, learning from what has worked before for this specific merchant.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">4</span>
                  <div>
                    <p className="font-semibold text-white">Adaptive Improvement</p>
                    <p className="text-slate-400 text-xs">Over time, the system builds merchant-specific evidence about which strategies work best for which failure types, continuously improving recovery rates.</p>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </>
  );
}
