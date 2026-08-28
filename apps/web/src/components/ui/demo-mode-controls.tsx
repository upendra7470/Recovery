'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDemoStatus,
  runDemo,
  resetDemo,
  type DemoStatusResponse,
  type DemoRunResponse,
  type DemoResetResponse,
} from '@/lib/api/demo';
import { SectionCard } from './section-card';

function formatPaise(amount: number): string {
  return `₹${(amount / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function DemoModeControls() {
  const router = useRouter();
  const [status, setStatus] = useState<DemoStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoRunResponse | DemoResetResponse | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const demoStatus = await getDemoStatus();
        setStatus(demoStatus);
      } catch {
        // Demo mode is disabled or not available
        setStatus({
          enabled: false,
          hasDemoData: false,
          isRunning: false,
          counts: { merchants: 0, paymentEvents: 0, opportunities: 0, decisions: 0, executions: 0, aiAdvice: 0 },
          metrics: { revenueAtRisk: 0, recoverableRevenue: 0, recoveredRevenue: 0, recoveryRate: 0, openOpportunities: 0, successfulRecoveries: 0, blockedActions: 0, humanReviews: 0 },
          lastRunScenario: null,
        });
      }
    }
    loadStatus();
  }, []);

  const refreshAll = useCallback(() => {
    // Refresh the current page's server-rendered data
    router.refresh();
  }, [router]);

  const handleRunDemo = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const demoResult = await runDemo();
      setResult(demoResult);
      // Refresh status
      const newStatus = await getDemoStatus();
      setStatus(newStatus);
      // Refresh all server-rendered pages (Overview, Recovery Cases, etc.)
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run demo');
    } finally {
      setLoading(false);
    }
  };

  const handleResetDemo = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resetResult = await resetDemo();
      setResult(resetResult);
      // Refresh status
      const newStatus = await getDemoStatus();
      setStatus(newStatus);
      // Refresh all server-rendered pages
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset demo');
    } finally {
      setLoading(false);
    }
  };

  if (!status?.enabled) {
    return (
      <SectionCard title="Demo Mode" subtitle="Synthetic demonstration data">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          Demo mode is not enabled. Set <code className="font-mono text-xs">DEMO_MODE_ENABLED=true</code> in your environment to enable synthetic demonstration scenarios.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Demo Mode" subtitle="Synthetic demonstration data">
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
          <strong>Demo Mode Active</strong> — All data shown is synthetic and clearly marked. No real customer PII, payment credentials, or production transactions are used.
        </div>

        {status.hasDemoData && (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="text-slate-500">Merchants</div>
                <div className="text-lg font-semibold text-slate-900">{status.counts.merchants}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="text-slate-500">Payment Events</div>
                <div className="text-lg font-semibold text-slate-900">{status.counts.paymentEvents}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="text-slate-500">Opportunities</div>
                <div className="text-lg font-semibold text-slate-900">{status.counts.opportunities}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="text-slate-500">Decisions</div>
                <div className="text-lg font-semibold text-slate-900">{status.counts.decisions}</div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="text-slate-500">Executions</div>
                <div className="text-lg font-semibold text-slate-900">{status.counts.executions}</div>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-emerald-600">Recovered</div>
                <div className="text-lg font-semibold text-emerald-700">{formatPaise(status.metrics?.recoveredRevenue ?? 0)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="font-medium text-slate-700 mb-2">Scenario Status</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600">&#10003;</span>
                  <span className="text-slate-700">Successful Recovery — {formatPaise(249900)} recovered</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600">&#9632;</span>
                  <span className="text-slate-700">Unsafe Recovery — blocked (safety gate)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-600">&#9679;</span>
                  <span className="text-slate-700">Review Case — awaiting human review</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm"
          >
            Launch Command Center →
          </Link>
          <button
            onClick={handleRunDemo}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Running...' : 'Run Demo Scenarios'}
          </button>
          <button
            onClick={handleResetDemo}
            disabled={loading || !status.hasDemoData}
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Resetting...' : 'Reset Demo Data'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && 'scenarios' in result && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <strong>Demo scenarios executed successfully.</strong>
            <div className="mt-2 space-y-1">
              {(result as DemoRunResponse).scenarios.map((scenario, i) => (
                <div key={i} className="text-xs">
                  <span className="font-medium">{scenario.scenario}:</span> {scenario.description}
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs font-medium">
              Total recovered: {formatPaise((result as DemoRunResponse).summary.recoveredAmount)}
            </div>
          </div>
        )}

        {result && 'deleted' in result && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Demo data reset. Deleted {(result as DemoResetResponse).deleted} synthetic records.
          </div>
        )}

        <p className="text-xs text-slate-500">
          Demo mode runs three synthetic scenarios with full lifecycle: successful recovery (retry + captured), unsafe recovery (blocked), and AI-assisted review.
          All data is clearly marked as synthetic and isolated from production data.
        </p>
      </div>
    </SectionCard>
  );
}
