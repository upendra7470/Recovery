'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  startSimulation,
  getSimulationRun,
  getSimulationAnalytics,
  previewDataset,
  type SimulationRun,
  type SimulationAnalytics,
  type SimulationApiError,
} from '@/lib/api/simulation';
import { formatMinorAmount, formatPercent } from '@/lib/format';

const PRESET_SIZES = [
  { label: '100', events: 100 },
  { label: '1,000', events: 1000 },
  { label: '10,000', events: 10000 },
] as const;

export default function SimulationLabPage() {
  const [seed, setSeed] = useState(42);
  const [events, setEvents] = useState(100);
  const [merchantCount, setMerchantCount] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<SimulationRun | null>(null);
  const [analytics, setAnalytics] = useState<SimulationAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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

  const pollRun = useCallback(
    (runId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const status = await getSimulationRun(runId);
          setRunStatus(status);
          if (status.status === 'completed' || status.status === 'failed') {
            stopPolling();
            setIsRunning(false);
            if (status.status === 'completed') {
              const a = await getSimulationAnalytics(runId);
              setAnalytics(a);
            }
          }
        } catch {
          stopPolling();
          setIsRunning(false);
        }
      }, 1000);
    },
    [stopPolling],
  );

  const handleRun = async () => {
    setError(null);
    setAnalytics(null);
    setRunStatus(null);
    setIsRunning(true);

    try {
      const result = await startSimulation({
        seed,
        events,
        merchantCount,
      });

      // For small simulations, they complete synchronously
      // Poll to get final state
      pollRun(result.runId);
    } catch (err) {
      const apiErr = err as SimulationApiError;
      setError(apiErr.message);
      setIsRunning(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await previewDataset({
        seed,
        merchantCount,
        paymentsPerMerchant: Math.ceil(events / merchantCount),
      });
      setPreview(result as Record<string, number>);
    } catch (err) {
      const apiErr = err as SimulationApiError;
      setError(apiErr.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const progress = runStatus
    ? runStatus.totalEvents > 0
      ? Math.round((runStatus.processedEvents / runStatus.totalEvents) * 100)
      : 0
    : 0;

  const isPolling = isRunning && runStatus?.status === 'running';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">RecoveryOS Simulation Lab</h1>
        <p className="mt-1 text-sm text-slate-500">
          Stress-test revenue recovery against deterministic synthetic payment events.
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Configuration</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Seed */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Event Count */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Event Count</label>
            <div className="mt-1 flex gap-2">
              {PRESET_SIZES.map((preset) => (
                <button
                  key={preset.events}
                  onClick={() => setEvents(preset.events)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    events === preset.events
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Merchant Count */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Merchants</label>
            <input
              type="number"
              value={merchantCount}
              min={1}
              max={100}
              onChange={(e) => setMerchantCount(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? 'Running...' : 'Run Simulation'}
          </button>
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewLoading ? 'Loading...' : 'Preview Dataset'}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {/* Running Status */}
      {isPolling && runStatus && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-indigo-900">Simulation Running</h2>
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm text-indigo-700">
              <span>
                Events processed: {runStatus.processedEvents.toLocaleString()} /{' '}
                {runStatus.totalEvents.toLocaleString()}
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-indigo-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {runStatus?.status === 'completed' && analytics && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              label="Revenue at Risk"
              value={formatMinorAmount(analytics.revenue.atRisk, 'INR')}
              tone="risk"
            />
            <MetricCard
              label="Recoverable Revenue"
              value={formatMinorAmount(analytics.revenue.recoverable, 'INR')}
              tone="warn"
            />
            <MetricCard
              label="Recovered Revenue"
              value={formatMinorAmount(analytics.revenue.recovered, 'INR')}
              tone="positive"
            />
            <MetricCard
              label="Recovery Rate"
              value={formatPercent(analytics.revenue.recoveryRate * 100, 1)}
              tone="positive"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <MetricCard
              label="Successful Recoveries"
              value={String(analytics.recovery.recoveriesVerified)}
              tone="positive"
            />
            <MetricCard
              label="Blocked Actions"
              value={String(analytics.recovery.blocked)}
              tone="warn"
            />
            <MetricCard
              label="Human Reviews"
              value={String(analytics.recovery.humanReview)}
              tone="neutral"
            />
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Dataset Info */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Dataset</h3>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between">
                  <dt>Total Events</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.dataset.events.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Merchants</dt>
                  <dd className="font-medium text-slate-900">{analytics.dataset.merchants}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Events / Merchant</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.dataset.eventsPerMerchant}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Seed</dt>
                  <dd className="font-medium text-slate-900">{analytics.seed}</dd>
                </div>
              </dl>
            </div>

            {/* Payments */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Payments</h3>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between">
                  <dt>Total</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.payments.total.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Successful</dt>
                  <dd className="font-medium text-green-600">
                    {analytics.payments.successful.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Failed</dt>
                  <dd className="font-medium text-red-600">
                    {analytics.payments.failed.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Recovery Pipeline */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Recovery Pipeline</h3>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between">
                  <dt>Opportunities Detected</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.recovery.opportunitiesDetected}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Executions Attempted</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.recovery.executionsAttempted}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Blocked</dt>
                  <dd className="font-medium text-amber-600">{analytics.recovery.blocked}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Human Review</dt>
                  <dd className="font-medium text-blue-600">{analytics.recovery.humanReview}</dd>
                </div>
              </dl>
            </div>

            {/* Performance */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Performance</h3>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between">
                  <dt>Duration</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.performance.durationMs !== null
                      ? `${(analytics.performance.durationMs / 1000).toFixed(1)}s`
                      : 'N/A'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Events / Second</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.performance.eventsPerSecond !== null
                      ? Math.round(analytics.performance.eventsPerSecond).toLocaleString()
                      : 'N/A'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Started</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.performance.startedAt
                      ? new Date(analytics.performance.startedAt).toLocaleTimeString()
                      : 'N/A'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Completed</dt>
                  <dd className="font-medium text-slate-900">
                    {analytics.performance.completedAt
                      ? new Date(analytics.performance.completedAt).toLocaleTimeString()
                      : 'N/A'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}

      {/* Preview */}
      {preview && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Dataset Preview</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4">
            <div>
              <dt>Merchants</dt>
              <dd className="font-medium text-slate-900">{preview.merchants}</dd>
            </div>
            <div>
              <dt>Customers</dt>
              <dd className="font-medium text-slate-900">{preview.customers}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd className="font-medium text-slate-900">{preview.orders}</dd>
            </div>
            <div>
              <dt>Payments</dt>
              <dd className="font-medium text-slate-900">{preview.payments}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'risk' | 'warn' | 'positive' | 'neutral';
}) {
  const toneClasses = {
    risk: 'border-red-200 bg-red-50 text-red-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    positive: 'border-green-200 bg-green-50 text-green-900',
    neutral: 'border-slate-200 bg-slate-50 text-slate-900',
  };

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
