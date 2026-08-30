'use client';

import { useState, useRef, useCallback } from 'react';
import {
  runModuleScenario,
  MODULE_SCENARIOS,
  type ModuleScenarioKey,
  type ModuleScenarioResponse,
} from '@/lib/api/demo';
import { formatMinorAmount } from '@/lib/format';

interface LiveEventItem {
  id: string;
  timestamp: string;
  text: string;
  tone: 'risk' | 'positive' | 'warn' | 'neutral' | 'indigo';
}

function getNow(): string {
  const d = new Date();
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function ModuleScenarioRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [selected, setSelected] = useState<ModuleScenarioKey>('subscription_success');
  const [result, setResult] = useState<ModuleScenarioResponse | null>(null);
  const [events, setEvents] = useState<LiveEventItem[]>([]);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const addEvent = useCallback((text: string, tone: LiveEventItem['tone'] = 'neutral') => {
    setEvents((prev) => [...prev, { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: getNow(), text, tone }]);
  }, []);

  const handleRun = useCallback(async () => {
    clearTimers();
    setIsRunning(true);
    setResult(null);
    setEvents([]);

    addEvent(`Running module scenario: ${selected}`, 'indigo');
    addEvent('Initializing module detection pipeline...', 'neutral');

    try {
      const res = await runModuleScenario(selected);
      if (!res) {
        addEvent('Scenario failed or API unavailable', 'risk');
        setIsRunning(false);
        return;
      }

      addEvent(`Module detected: ${res.moduleType}`, 'indigo');
      addEvent(`Event ingested: ${res.description}`, 'neutral');

      const stages = res.stages;
      for (let i = 0; i < stages.length; i++) {
        const stageData = stages[i]!;
        const timer = setTimeout(() => {
          addEvent(`[${stageData.key}] ${stageData.title}: ${stageData.subtitle}`, stageData.status === 'blocked' ? 'risk' : stageData.status === 'review' ? 'warn' : 'positive');
        }, (i + 1) * 600);
        timersRef.current.push(timer);
      }

      const finalTimer = setTimeout(() => {
        setResult(res);
        setIsRunning(false);
        addEvent(
          res.recovered
            ? `Outcome: RECOVERED ${formatMinorAmount(res.recoveredAmount, 'INR')}`
            : `Outcome: ${res.executionStatus} — ${res.decisionAction}`,
          res.recovered ? 'positive' : res.executionStatus === 'BLOCKED' ? 'risk' : 'warn'
        );
        addEvent('Module scenario complete', 'neutral');
      }, (stages.length + 1) * 600);
      timersRef.current.push(finalTimer);
    } catch {
      addEvent('Module scenario execution failed', 'risk');
      setIsRunning(false);
    }
  }, [selected, clearTimers, addEvent]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Module Scenario Runner</h2>
        <p className="text-sm text-slate-500">Run module-specific recovery scenarios through the full RecoveryOS pipeline.</p>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">
          {MODULE_SCENARIOS.map((sc) => (
            <button
              key={sc.key}
              onClick={() => setSelected(sc.key)}
              disabled={isRunning}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                selected === sc.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              } disabled:opacity-50`}
            >
              {sc.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleRun}
          disabled={isRunning}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {isRunning ? 'Running...' : `Run: ${MODULE_SCENARIOS.find((s) => s.key === selected)?.label}`}
        </button>

        {events.length > 0 && (
          <div className="mt-4 rounded-lg bg-slate-900 p-4 max-h-64 overflow-y-auto font-mono text-xs">
            {events.map((e) => (
              <div key={e.id} className={`py-0.5 ${
                e.tone === 'positive' ? 'text-emerald-400' :
                e.tone === 'risk' ? 'text-rose-400' :
                e.tone === 'warn' ? 'text-amber-400' :
                e.tone === 'indigo' ? 'text-indigo-400' : 'text-slate-400'
              }`}>
                <span className="text-slate-600">{e.timestamp}</span> {e.text}
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-xs text-slate-500">Module</div>
                <div className="text-sm font-semibold text-indigo-600">{result.moduleType.replace(/_/g, ' ')}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Action</div>
                <div className="text-sm font-semibold">{result.decisionAction}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <div className={`text-sm font-semibold ${result.recovered ? 'text-emerald-600' : result.executionStatus === 'BLOCKED' ? 'text-rose-600' : 'text-amber-600'}`}>
                  {result.recovered ? 'RECOVERED' : result.executionStatus}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Amount</div>
                <div className="text-sm font-semibold">{formatMinorAmount(result.amount, result.currency)}</div>
              </div>
            </div>
            {result.aiAdvice && (
              <div className="rounded-lg bg-indigo-50 p-3 text-sm">
                <div className="font-medium text-indigo-900">AI Recommendation</div>
                <div className="text-indigo-700 mt-1">{result.aiAdvice.summary}</div>
              </div>
            )}
            <div className="mt-3 text-xs text-slate-500">{result.description}</div>
          </div>
        )}
      </div>
    </div>
  );
}
