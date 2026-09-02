'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  getJudgeScenarios,
  startJudgeScenario,
  getJudgeRunStatus,
  type JudgeScenario,
  type JudgeStatusResponse,
  type JudgeApiError,
} from '@/lib/api/judge';
import { formatMinorAmount, formatPercent } from '@/lib/format';

type RunPhase = 'idle' | 'starting' | 'running' | 'completed' | 'error';

export default function JudgeModePage() {
  const [scenarios, setScenarios] = useState<JudgeScenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [runStatus, setRunStatus] = useState<JudgeStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState(1000);
  const [seed, setSeed] = useState(42);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Load scenarios on mount
  useEffect(() => {
    getJudgeScenarios()
      .then((res) => setScenarios(res.scenarios))
      .catch(() => {
        setScenarios([
          { id: 'payment-failure-storm', name: 'Payment Failure Storm', description: 'High volume of failed payments with multiple failure reasons.', defaultSeed: 42, defaultEvents: 1000, defaultMerchantCount: 5 },
          { id: 'gateway-degradation', name: 'Gateway Degradation', description: 'Concentrated gateway/network failures.', defaultSeed: 77, defaultEvents: 1000, defaultMerchantCount: 5 },
          { id: 'mixed-recovery', name: 'Mixed Recovery', description: 'Realistic mixture of outcomes.', defaultSeed: 123, defaultEvents: 1000, defaultMerchantCount: 5 },
          { id: 'recovery-stress', name: 'Recovery Stress Test', description: 'Large-scale stress test.', defaultSeed: 999, defaultEvents: 10000, defaultMerchantCount: 10 },
        ]);
      });
  }, []);

  const pollRun = useCallback(
    (runId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const status = await getJudgeRunStatus(runId);
          setRunStatus(status);
          if (status.status === 'completed' || status.status === 'failed') {
            stopPolling();
            setPhase(status.status === 'completed' ? 'completed' : 'error');
            if (status.status === 'completed') {
              // Analytics available via separate endpoint if needed
            }
          }
        } catch {
          stopPolling();
          setPhase('error');
        }
      }, 1000);
    },
    [stopPolling],
  );

  const handleStart = async () => {
    if (!selectedScenario) return;
    setError(null);
    setRunStatus(null);
    setPhase('starting');

    try {
      const result = await startJudgeScenario({
        scenario: selectedScenario,
        seed,
        events,
      });
      setPhase('running');
      pollRun(result.runId);
    } catch (err) {
      const apiErr = err as JudgeApiError;
      setError(apiErr.message);
      setPhase('idle');
    }
  };

  const selected = scenarios.find((s) => s.id === selectedScenario);
  const progress = runStatus
    ? runStatus.totalEvents > 0
      ? Math.round((runStatus.processedEvents / runStatus.totalEvents) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Judge Mode
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Run controlled RecoveryOS scenarios and watch the actual recovery pipeline process
            synthetic events in real time.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/simulation"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Simulation Lab
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Scenario Selection — only in idle phase */}
      {phase === 'idle' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Choose a Scenario</h2>
          <p className="mt-1 text-xs text-slate-500">
            Each scenario uses the existing RecoveryOS pipeline with different failure distributions.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => setSelectedScenario(scenario.id)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  selectedScenario === scenario.id
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">{scenario.name}</p>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  {scenario.description}
                </p>
                <div className="mt-2 flex gap-3 text-[10px] text-slate-400">
                  <span>{scenario.defaultEvents.toLocaleString()} events</span>
                  <span>{scenario.defaultMerchantCount} merchants</span>
                  <span>seed {scenario.defaultSeed}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Configuration */}
          {selectedScenario && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Seed</label>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Events</label>
                  <div className="mt-1 flex gap-1">
                    {[100, 1000, 10000].map((n) => (
                      <button
                        key={n}
                        onClick={() => setEvents(n)}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                          events === n
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {n >= 1000 ? `${n / 1000}k` : n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleStart}
                    disabled={!selectedScenario}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start Scenario
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
        </div>
      )}

      {/* Running / Starting State */}
      {(phase === 'starting' || phase === 'running') && runStatus && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-indigo-900">
                {phase === 'starting' ? 'Starting Scenario...' : 'Scenario Running'}
              </h2>
              <p className="mt-0.5 text-xs text-indigo-700">
                {selected?.name ?? runStatus.scenario}
              </p>
            </div>
            <span className="rounded-full bg-indigo-200 px-3 py-1 text-xs font-bold text-indigo-900">
              {progress}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-indigo-700">
              <span>
                {runStatus.processedEvents.toLocaleString()} / {runStatus.totalEvents.toLocaleString()} events
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-indigo-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Live metrics */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniMetric label="Revenue at Risk" value={formatMinorAmount(runStatus.revenueAtRisk, 'INR')} tone="risk" />
            <MiniMetric label="Opportunities" value={String(runStatus.opportunitiesDetected)} tone="neutral" />
            <MiniMetric label="Approved" value={String(runStatus.executionsAttempted - runStatus.executionsBlocked)} tone="positive" />
            <MiniMetric label="Blocked" value={String(runStatus.executionsBlocked)} tone="warn" />
          </div>
        </div>
      )}

      {/* Starting without runStatus yet */}
      {phase === 'starting' && !runStatus && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm text-center">
          <div className="inline-flex items-center gap-2 text-indigo-700">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">Generating dataset and starting recovery pipeline...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {phase === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-red-900">Scenario Failed</h2>
          <p className="mt-1 text-xs text-red-700">
            {error ?? 'The scenario encountered an error during processing.'}
          </p>
          <button
            onClick={() => { setPhase('idle'); setRunStatus(null); setError(null); }}
            className="mt-3 inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Completed State */}
      {phase === 'completed' && runStatus && (
        <>
          {/* Summary Banner */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-semibold text-emerald-900">Scenario Complete</h2>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryMetric label="Events Processed" value={runStatus.processedEvents.toLocaleString()} />
              <SummaryMetric label="Revenue at Risk" value={formatMinorAmount(runStatus.revenueAtRisk, 'INR')} />
              <SummaryMetric label="Recovered Revenue" value={formatMinorAmount(runStatus.recoveredRevenue, 'INR')} />
              <SummaryMetric
                label="Recovery Rate"
                value={formatPercent(runStatus.recoveryRate * 100, 1)}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryMetric label="Opportunities" value={String(runStatus.opportunitiesDetected)} />
              <SummaryMetric label="Approved" value={String(runStatus.executionsAttempted - runStatus.executionsBlocked)} />
              <SummaryMetric label="Blocked" value={String(runStatus.executionsBlocked)} />
              <SummaryMetric label="Verified Recoveries" value={String(runStatus.recoveriesVerified)} />
            </div>
            {runStatus.durationMs !== null && (
              <p className="mt-3 text-xs text-emerald-700">
                Completed in {(runStatus.durationMs / 1000).toFixed(1)}s
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setPhase('idle'); setRunStatus(null); }}
                className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Run Again
              </button>
              <Link
                href="/"
                className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                View Dashboard
              </Link>
              <Link
                href="/recovery-cases"
                className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                View Recovery Cases
              </Link>
            </div>
          </div>

          {/* Detailed Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Revenue at Risk" value={formatMinorAmount(runStatus.revenueAtRisk, 'INR')} tone="risk" />
            <StatCard label="Recoverable Revenue" value={formatMinorAmount(runStatus.recoverableRevenue, 'INR')} />
            <StatCard label="Recovered Revenue" value={formatMinorAmount(runStatus.recoveredRevenue, 'INR')} tone="positive" />
            <StatCard label="Recovery Rate" value={formatPercent(runStatus.recoveryRate * 100, 1)} tone="positive" />
          </div>

          {/* Pipeline & Safety */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Recovery Pipeline</h3>
              <div className="mt-3 space-y-2 text-xs">
                <Row label="Opportunities Detected" value={String(runStatus.opportunitiesDetected)} />
                <Row label="Executions Attempted" value={String(runStatus.executionsAttempted)} />
                <Row label="Verified Recoveries" value={String(runStatus.recoveriesVerified)} accent="emerald" />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Safety & Compliance</h3>
              <div className="mt-3 space-y-2 text-xs">
                <Row label="Approved by Safety" value={String(runStatus.executionsAttempted - runStatus.executionsBlocked)} accent="emerald" />
                <Row label="Blocked by Policy" value={String(runStatus.executionsBlocked)} accent="amber" />
                <Row label="Human Review Required" value={String(runStatus.humanReviews)} accent="blue" />
              </div>
            </div>
          </div>

          {/* Recent Events */}
          {runStatus.recentEvents.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <header className="border-b border-slate-100 px-6 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Recent Recovery Events</h3>
                <p className="mt-0.5 text-xs text-slate-500">Latest {runStatus.recentEvents.length} events from the pipeline</p>
              </header>
              <div className="divide-y divide-slate-100">
                {runStatus.recentEvents.map((evt, i) => {
                  const e = evt as Record<string, unknown>;
                  return (
                    <div key={i} className="flex items-center gap-3 px-6 py-2.5 text-xs">
                      <EventBadge type={String(e.eventType ?? 'unknown')} />
                      <span className="font-mono text-slate-500">
                        {String(e.providerPaymentId ?? '').slice(0, 12)}
                      </span>
                      {typeof e.amount === 'number' && (
                        <span className="font-medium text-slate-700">
                          {formatMinorAmount(e.amount, String(e.currency ?? 'INR'))}
                        </span>
                      )}
                      {typeof e.recovered === 'boolean' && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          e.recovered ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {e.recovered ? 'RECOVERED' : 'PENDING'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'risk' | 'positive' }) {
  const tones = {
    neutral: 'text-slate-900',
    risk: 'text-rose-600',
    positive: 'text-emerald-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: 'risk' | 'warn' | 'positive' | 'neutral' }) {
  const tones = {
    risk: 'text-rose-700',
    warn: 'text-amber-700',
    positive: 'text-emerald-700',
    neutral: 'text-slate-700',
  };
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-2.5">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-emerald-900 tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'amber' | 'blue' }) {
  const colors = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold font-mono ${accent ? colors[accent] : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const color = type.includes('failed')
    ? 'bg-rose-100 text-rose-800'
    : type.includes('captured')
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-slate-100 text-slate-700';
  const label = type.includes('failed') ? 'FAILED' : type.includes('captured') ? 'CAPTURED' : type.slice(0, 12).toUpperCase();
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}
    </span>
  );
}
