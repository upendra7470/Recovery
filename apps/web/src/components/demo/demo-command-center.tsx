'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDemoStatus,
  runDemo,
  resetDemo,
  type DemoStatusResponse,
  type DemoScenarioResponse,
  type DemoStageTrace,
  type DemoMetrics,
} from '@/lib/api/demo';
import { formatMinorAmount, formatPercent } from '@/lib/format';

interface LiveEventItem {
  id: string;
  timestamp: string;
  text: string;
  tone: 'risk' | 'positive' | 'warn' | 'neutral' | 'indigo';
  details?: string;
}

const DEFAULT_METRICS: DemoMetrics = {
  revenueAtRisk: 0,
  recoverableRevenue: 0,
  recoveredRevenue: 0,
  recoveryRate: 0,
  openOpportunities: 0,
  successfulRecoveries: 0,
  blockedActions: 0,
  humanReviews: 0,
};

const PIPELINE_NODES = [
  { key: 'PAYMENT_EVENT', label: 'Payment Event' },
  { key: 'RISK_ENGINE', label: 'Risk Engine' },
  { key: 'RECOVERY_INTELLIGENCE', label: 'Recovery Intel' },
  { key: 'AI_DECISION', label: 'AI Decision' },
  { key: 'SAFETY_POLICY', label: 'Safety Policy' },
  { key: 'ACTION_ORCHESTRATOR', label: 'Action Orchestrator' },
  { key: 'PAYMENT_PROVIDER', label: 'Payment Provider' },
  { key: 'WEBHOOK', label: 'Webhook' },
  { key: 'OUTCOME_VERIFICATION', label: 'Outcome Verification' },
  { key: 'RECOVERED_REVENUE', label: 'Recovered Revenue' },
] as const;

function getPipelineStatus(
  nodeIndex: number,
  activeStageIndex: number,
  scenario: DemoScenarioResponse | null,
  isRunning: boolean
): 'completed' | 'active' | 'blocked' | 'review' | 'pending' {
  if (activeStageIndex === -1) {
    return scenario ? (nodeIndex <= 9 ? 'completed' : 'pending') : 'pending';
  }

  if (nodeIndex < activeStageIndex) {
    // Check if it was blocked or review
    if (scenario?.scenario === 'UNSAFE_RECOVERY' && nodeIndex >= 5) {
      return 'blocked';
    }
    if (scenario?.scenario === 'REVIEW_CASE' && nodeIndex >= 5) {
      return 'review';
    }
    return 'completed';
  }

  if (nodeIndex === activeStageIndex) {
    if (scenario?.scenario === 'UNSAFE_RECOVERY' && nodeIndex >= 5) {
      return isRunning ? 'active' : 'blocked';
    }
    if (scenario?.scenario === 'REVIEW_CASE' && nodeIndex >= 5) {
      return isRunning ? 'active' : 'review';
    }
    return isRunning ? 'active' : 'completed';
  }

  return 'pending';
}

function getNowTimestamp(): string {
  const d = new Date();
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function DemoCommandCenter({
  initialStatus,
}: {
  initialStatus: DemoStatusResponse | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<DemoStatusResponse | null>(initialStatus);
  const [selectedScenario, setSelectedScenario] = useState<'successful' | 'unsafe' | 'review' | 'all'>('successful');
  const [isRunning, setIsRunning] = useState(false);
  const [activeStageIndex, setActiveStageIndex] = useState<number>(-1);
  const [visibleStages, setVisibleStages] = useState<DemoStageTrace[]>([]);
  const [currentScenario, setCurrentScenario] = useState<DemoScenarioResponse | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEventItem[]>([
    {
      id: 'init-1',
      timestamp: getNowTimestamp(),
      text: 'RecoveryOS Demo Command Center initialized',
      tone: 'indigo',
      details: 'Ready to demonstrate live payment recovery lifecycle',
    },
    {
      id: 'init-2',
      timestamp: getNowTimestamp(),
      text: 'Safety gate active · Deterministic policies enforced',
      tone: 'neutral',
      details: 'No real payment credentials required',
    },
  ]);
  const [metrics, setMetrics] = useState<DemoMetrics>(initialStatus?.metrics ?? DEFAULT_METRICS);
  const [error, setError] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);

  const eventStreamEndRef = useRef<HTMLDivElement>(null);
  const activeTimersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAllTimers = useCallback(() => {
    activeTimersRef.current.forEach((t) => clearTimeout(t));
    activeTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  useEffect(() => {
    eventStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveEvents]);

  const addEvent = (text: string, tone: LiveEventItem['tone'], details?: string) => {
    setLiveEvents((prev) => [
      ...prev,
      {
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: getNowTimestamp(),
        text,
        tone,
        details,
      },
    ]);
  };

  const playScenarioStages = (
    scenario: DemoScenarioResponse,
    scenarioIndex: number,
    totalScenarios: number,
    onComplete?: () => void
  ) => {
    setCurrentScenario(scenario);
    setVisibleStages([]);
    setActiveStageIndex(0);

    const stages = scenario.stages;
    const stageDuration = 650; // ms per stage (total ~6.5 seconds)

    stages.forEach((stage, idx) => {
      const timer = setTimeout(() => {
        setActiveStageIndex(idx);
        setVisibleStages((prev) => [...prev, stage]);
        setProgressPercent(Math.round(((idx + 1) / stages.length) * 100));

        // Add dynamic event stream entry
        const tone: LiveEventItem['tone'] =
          stage.status === 'completed'
            ? stage.key === 'PAYMENT_FAILED'
              ? 'risk'
              : 'positive'
            : stage.status === 'blocked'
              ? 'warn'
              : stage.status === 'review'
                ? 'warn'
                : 'neutral';

        addEvent(
          `${stage.name}: ${stage.title}`,
          tone,
          stage.subtitle
        );

        // Progressively update metrics to make it feel alive!
        if (stage.key === 'PAYMENT_FAILED') {
          setMetrics((prev) => ({
            ...prev,
            revenueAtRisk: prev.revenueAtRisk + scenario.amount,
            recoverableRevenue: prev.recoverableRevenue + scenario.amount,
            openOpportunities: prev.openOpportunities + 1,
          }));
        } else if (stage.key === 'SAFETY_POLICY' && stage.status === 'blocked') {
          setMetrics((prev) => ({
            ...prev,
            blockedActions: prev.blockedActions + 1,
            revenueAtRisk: Math.max(0, prev.revenueAtRisk - scenario.amount),
          }));
        } else if (stage.key === 'SAFETY_POLICY' && stage.status === 'review') {
          setMetrics((prev) => ({
            ...prev,
            humanReviews: prev.humanReviews + 1,
            revenueAtRisk: Math.max(0, prev.revenueAtRisk - scenario.amount),
          }));
        } else if (stage.key === 'OUTCOME_VERIFIED' && scenario.recovered) {
          setMetrics((prev) => {
            const newRecovered = prev.recoveredRevenue + scenario.recoveredAmount;
            const newRisk = Math.max(0, prev.revenueAtRisk - scenario.amount);
            const total = newRecovered + newRisk;
            const rate = total > 0 ? Math.round((newRecovered / total) * 100) : 100;
            return {
              ...prev,
              recoveredRevenue: newRecovered,
              revenueAtRisk: newRisk,
              recoveryRate: rate,
              successfulRecoveries: prev.successfulRecoveries + 1,
              openOpportunities: Math.max(0, prev.openOpportunities - 1),
            };
          });
        }

        if (idx === stages.length - 1) {
          addEvent(
            `Scenario "${scenario.scenarioName}" concluded: ${scenario.description}`,
            scenario.recovered ? 'positive' : 'warn'
          );
          if (onComplete) {
            const completionTimer = setTimeout(onComplete, 800);
            activeTimersRef.current.push(completionTimer);
          }
        }
      }, idx * stageDuration);

      activeTimersRef.current.push(timer);
    });
  };

  const handleRunScenario = async (targetScenario: 'successful' | 'unsafe' | 'review' | 'all') => {
    if (isRunning) return;

    clearAllTimers();
    setIsRunning(true);
    setError(null);
    setProgressPercent(0);
    setVisibleStages([]);
    setActiveStageIndex(-1);

    addEvent(
      `Starting live recovery run [Scenario: ${targetScenario.toUpperCase()}]`,
      'indigo',
      'Triggering backend state machine & verification ledger'
    );

    try {
      const response = await runDemo(targetScenario);

      if (response.scenarios.length === 0) {
        throw new Error('No scenarios were returned by the backend.');
      }

      if (targetScenario === 'all' && response.scenarios.length > 1) {
        // Sequential playback for all scenarios
        let currentIndex = 0;
        const playNext = () => {
          if (currentIndex < response.scenarios.length) {
            const sc = response.scenarios[currentIndex]!;
            currentIndex++;
            playScenarioStages(sc, currentIndex - 1, response.scenarios.length, () => {
              if (currentIndex < response.scenarios.length) {
                addEvent(
                  `Proceeding to next scenario (${currentIndex + 1}/${response.scenarios.length})...`,
                  'indigo'
                );
                playNext();
              } else {
                setIsRunning(false);
                setMetrics(response.metrics);
                router.refresh();
              }
            });
          }
        };
        playNext();
      } else {
        // Single scenario playback
        const sc = response.scenarios[0]!;
        playScenarioStages(sc, 0, 1, () => {
          setIsRunning(false);
          setMetrics(response.metrics);
          router.refresh();
        });
      }

      const newStatus = await getDemoStatus();
      setStatus(newStatus);
    } catch (err) {
      setIsRunning(false);
      setError(err instanceof Error ? err.message : 'Failed to execute demo scenario');
      addEvent(
        `Demo execution error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'risk'
      );
    }
  };

  const handleReset = async () => {
    if (isRunning) return;

    clearAllTimers();
    setIsRunning(true);
    setError(null);
    setProgressPercent(0);
    setVisibleStages([]);
    setActiveStageIndex(-1);
    setCurrentScenario(null);

    try {
      await resetDemo();
      setMetrics(DEFAULT_METRICS);
      const newStatus = await getDemoStatus();
      setStatus(newStatus);
      setLiveEvents([
        {
          id: `ev-reset-${Date.now()}`,
          timestamp: getNowTimestamp(),
          text: 'Demo environment reset to clean baseline',
          tone: 'indigo',
          details: 'All synthetic opportunities, decisions, and executions cleared.',
        },
      ]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-3 w-3 items-center justify-center">
                <span className="absolute h-3 w-3 animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-indigo-300">
                Phase 11.2 · Demo Command Center
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              RecoveryOS Live Revenue Recovery
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              Watch real-time revenue leakage detection, AI decisioning, deterministic safety policy validation, and verified payment recovery.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
              ● DEMO MODE
            </span>
            <span className="inline-flex items-center rounded-full bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
              ● Synthetic Data
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              ● Safe Execution
            </span>
          </div>
        </div>

        {/* Linear running progress indicator */}
        {isRunning && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-indigo-200">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-indigo-400" />
                Demo Running: {currentScenario?.scenarioName ?? 'Executing Lifecycle'}...
              </span>
              <span className="font-mono">{progressPercent}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Scenario Selector */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="scenario-select" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Scenario
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedScenario('successful')}
                disabled={isRunning}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedScenario === 'successful'
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                🟢 Scenario A: Successful Recovery (₹2,499)
              </button>
              <button
                type="button"
                onClick={() => setSelectedScenario('unsafe')}
                disabled={isRunning}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedScenario === 'unsafe'
                    ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-600/20'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                🔴 Scenario B: Unsafe Recovery (₹1,500 · Blocked)
              </button>
              <button
                type="button"
                onClick={() => setSelectedScenario('review')}
                disabled={isRunning}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedScenario === 'review'
                    ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                🟡 Scenario C: Review Case (₹999 · Human in Loop)
              </button>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleRunScenario(selectedScenario)}
              disabled={isRunning}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isRunning ? 'Running Live Recovery...' : 'RUN LIVE RECOVERY'}
            </button>

            <button
              type="button"
              onClick={() => handleRunScenario('all')}
              disabled={isRunning}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              RUN ALL SCENARIOS
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={isRunning || !status?.hasDemoData}
              className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-sm font-medium text-rose-700 transition-all hover:bg-rose-100/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              RESET DEMO
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      {/* Live Metrics Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Revenue at Risk</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-rose-600">
            {formatMinorAmount(metrics.revenueAtRisk, 'INR')}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">Exposed failures</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Recoverable</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
            {formatMinorAmount(metrics.recoverableRevenue, 'INR')}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">Total volume</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700">Recovered Revenue</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">
            {formatMinorAmount(metrics.recoveredRevenue, 'INR')}
          </p>
          <p className="mt-0.5 text-[10px] text-emerald-600">Verified in ledger</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Recovery Rate</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-indigo-700">
            {formatPercent(metrics.recoveryRate)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">Verified share</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Open Cases</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{metrics.openOpportunities}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Active leakage</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Successful</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-600">{metrics.successfulRecoveries}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Recovered (100%)</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Blocked Actions</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-amber-600">{metrics.blockedActions}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Safety prevented</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Human Reviews</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-indigo-600">{metrics.humanReviews}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">Ambiguous cases</p>
        </div>
      </div>

      {/* Visual Recovery Pipeline (10 Nodes) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Recovery Pipeline Flow
          </span>
          <span className="text-[11px] text-slate-400">End-to-end verified execution graph</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {PIPELINE_NODES.map((node, index) => {
            const nodeStatus = getPipelineStatus(index, activeStageIndex, currentScenario, isRunning);

            let badgeClass = 'border-slate-200 bg-slate-50 text-slate-400';
            let iconText = '○';

            if (nodeStatus === 'completed') {
              badgeClass = 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm';
              iconText = '✓';
            } else if (nodeStatus === 'active') {
              badgeClass = 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300 shadow-md animate-pulse';
              iconText = '●';
            } else if (nodeStatus === 'blocked') {
              badgeClass = 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm';
              iconText = '⊘';
            } else if (nodeStatus === 'review') {
              badgeClass = 'border-amber-300 bg-amber-50 text-amber-700 shadow-sm';
              iconText = '⚑';
            }

            return (
              <div
                key={node.key}
                className={`relative flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all ${badgeClass}`}
              >
                <span className="text-xs font-bold">{iconText}</span>
                <span className="mt-1 text-[11px] font-semibold leading-tight">{node.label}</span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider opacity-75">
                  {nodeStatus === 'active' ? 'PROCESSING' : nodeStatus}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split: Timeline (Left) & AI Decision + Event Stream (Right) */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Live Event Timeline (7 cols) */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Live Recovery Lifecycle
                </h2>
                <p className="text-xs text-slate-500">
                  Step-by-step telemetry as the recovery opportunity progresses through the engine
                </p>
              </div>
              {currentScenario && (
                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {currentScenario.scenarioName}
                </span>
              )}
            </div>

            {visibleStages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-indigo-50 p-3 text-indigo-600">
                  <svg className="h-8 w-8 stroke-current" fill="none" viewBox="0 0 24 24">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">
                  Command Center Idle
                </h3>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Click <strong className="text-indigo-600">RUN LIVE RECOVERY</strong> above to trigger a live scenario and follow the full lifecycle in real time.
                </p>
              </div>
            ) : (
              <div className="relative mt-5 space-y-4 border-l-2 border-slate-200 pl-4">
                {visibleStages.map((stage, idx) => {
                  const isLatest = idx === visibleStages.length - 1 && isRunning;
                  const isBlocked = stage.status === 'blocked';
                  const isReview = stage.status === 'review';

                  let dotColor = 'bg-emerald-500 ring-emerald-100';
                  if (stage.key === 'PAYMENT_FAILED') dotColor = 'bg-rose-500 ring-rose-100';
                  else if (isBlocked) dotColor = 'bg-amber-500 ring-amber-100';
                  else if (isReview) dotColor = 'bg-indigo-500 ring-indigo-100';

                  return (
                    <div
                      key={stage.id}
                      className={`relative rounded-xl border p-4 transition-all duration-300 ${
                        isLatest
                          ? 'border-indigo-300 bg-indigo-50/40 shadow-md ring-2 ring-indigo-200'
                          : isBlocked
                            ? 'border-amber-200 bg-amber-50/40'
                            : isReview
                              ? 'border-indigo-200 bg-indigo-50/30'
                              : 'border-slate-200 bg-white hover:bg-slate-50/60'
                      }`}
                    >
                      {/* Timeline dot */}
                      <span
                        className={`absolute -left-[25px] top-4.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ${dotColor}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      </span>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-indigo-600">
                            00:{String(Math.floor(stage.timeOffsetMs / 1000)).padStart(2, '0')}.{String(Math.floor((stage.timeOffsetMs % 1000) / 100))}
                          </span>
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                            {stage.title}
                          </span>
                        </div>

                        {stage.badge && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              stage.badgeTone === 'risk'
                                ? 'bg-rose-100 text-rose-800'
                                : stage.badgeTone === 'positive'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : stage.badgeTone === 'warn'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {stage.badge}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-xs font-medium text-slate-700">{stage.subtitle}</p>

                      {/* Detail attributes */}
                      {Object.keys(stage.details).length > 0 && (
                        <div className="mt-2.5 rounded-lg bg-slate-50/80 p-2.5 text-[11px] font-mono text-slate-600 ring-1 ring-inset ring-slate-200">
                          {Object.entries(stage.details).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2 py-0.5">
                              <span className="text-slate-400">{k}:</span>
                              <span className="truncate font-semibold text-slate-800">
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {currentScenario && visibleStages.length > 0 && (
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                <span className="text-slate-500">
                  Underlying Case ID:{' '}
                  <span className="font-mono text-indigo-600">{currentScenario.opportunityId.slice(0, 8)}...</span>
                </span>
                <Link
                  href={`/recovery-cases/${currentScenario.opportunityId}`}
                  className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  Inspect Full Recovery Case Detail →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: AI Decision Card (Top) & Real-Time Event Stream (Bottom) (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          {/* AI Recovery Decision Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                  Intelligent Decisioning
                </span>
                <h3 className="text-sm font-bold text-slate-900">AI RECOVERY DECISION</h3>
              </div>
              {currentScenario && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    currentScenario.decisionAction === 'RETRY'
                      ? 'bg-emerald-100 text-emerald-800'
                      : currentScenario.decisionAction === 'DO_NOT_RETRY'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {currentScenario.decisionAction}
                </span>
              )}
            </div>

            {currentScenario ? (
              <div className="mt-4 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                    <p className="text-[10px] text-slate-400">Confidence</p>
                    <p className="text-base font-bold tabular-nums text-slate-900">
                      {currentScenario.decisionConfidence}%
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                    <p className="text-[10px] text-slate-400">Risk Score</p>
                    <p className="text-base font-bold tabular-nums text-slate-900">
                      {currentScenario.decisionScore}/100
                    </p>
                  </div>
                </div>

                <div>
                  <p className="font-semibold text-slate-700">Why this decision?</p>
                  <ul className="mt-1.5 space-y-1 text-slate-600">
                    {currentScenario.decisionExplanation.map((reason, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {currentScenario.aiAdvice && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-indigo-950">
                    <p className="font-semibold text-indigo-900">AI Context Analysis</p>
                    <p className="mt-1 leading-relaxed text-indigo-900/80">
                      {currentScenario.aiAdvice.explanation}
                    </p>
                    {currentScenario.aiAdvice.operatorMessage && (
                      <p className="mt-2 border-t border-indigo-100 pt-1.5 text-[11px] text-indigo-700">
                        <strong>Operator note:</strong> {currentScenario.aiAdvice.operatorMessage}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <p className="font-semibold text-slate-700">Deterministic Policy Checks</p>
                  <div className="mt-1.5 space-y-1.5">
                    {currentScenario.policyChecks.map((check, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
                        <span className="flex items-center gap-1.5 text-slate-700">
                          <span className={check.passed ? 'font-bold text-emerald-600' : 'font-bold text-rose-600'}>
                            {check.passed ? '✓' : '✗'}
                          </span>
                          {check.name}
                        </span>
                        <span className="text-[10px] text-slate-500">{check.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
                  <strong>Safety Isolation:</strong> AI provides advisory context only. The deterministic policy engine strictly governs whether recovery actions are permitted.
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                Run a scenario to inspect AI recommendation, confidence metrics, and deterministic policy checks.
              </div>
            )}
          </div>

          {/* Real-Time Live Event Stream */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <h3 className="text-sm font-bold text-slate-900">LIVE EVENT STREAM</h3>
              </div>
              <span className="font-mono text-[10px] text-slate-400">Real-Time Ingestion</span>
            </div>

            <div className="mt-3 h-64 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-200 shadow-inner">
              <div className="space-y-2">
                {liveEvents.map((ev) => {
                  let toneColor = 'text-emerald-400';
                  if (ev.tone === 'risk') toneColor = 'text-rose-400';
                  else if (ev.tone === 'warn') toneColor = 'text-amber-400';
                  else if (ev.tone === 'indigo') toneColor = 'text-indigo-400';
                  else if (ev.tone === 'neutral') toneColor = 'text-slate-400';

                  return (
                    <div key={ev.id} className="leading-tight">
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-slate-500">[{ev.timestamp}]</span>
                        <span className={`font-semibold ${toneColor}`}>{ev.text}</span>
                      </div>
                      {ev.details && (
                        <div className="pl-20 text-[10px] text-slate-400">
                          ↳ {ev.details}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={eventStreamEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cross-Page Verification Hub */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          Verify Backend State Across RecoveryOS Dashboard
        </h3>
        <p className="text-xs text-slate-500">
          Demo data is written to the real PostgreSQL database. Click any module below to inspect consistent ledger state:
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Link
            href="/"
            className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">Platform Overview</p>
            <p className="mt-1 text-[11px] text-slate-500">Real-time revenue metrics & recovery summaries.</p>
          </Link>

          <Link
            href="/recovery-cases"
            className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">Recovery Cases</p>
            <p className="mt-1 text-[11px] text-slate-500">Inspect individual cases and audit logs.</p>
          </Link>

          <Link
            href="/operations"
            className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">Operations Feed</p>
            <p className="mt-1 text-[11px] text-slate-500">Execution attempts and webhook reconciliation.</p>
          </Link>

          <Link
            href="/ai-decisions"
            className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">AI Decision Logs</p>
            <p className="mt-1 text-[11px] text-slate-500">Explainable advice and policy guardrails.</p>
          </Link>

          <Link
            href="/payment-health"
            className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">Payment Health</p>
            <p className="mt-1 text-[11px] text-slate-500">Synthetic gateway reliability & telemetry.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
