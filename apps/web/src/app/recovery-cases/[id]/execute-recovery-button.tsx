'use client';

import { useState } from 'react';
import { requestExecution } from '@/lib/api/recovery-executions';

type Feedback =
  | { tone: 'ok'; message: string }
  | { tone: 'warn'; message: string }
  | { tone: 'error'; message: string };

export function ExecuteRecoveryButton({ opportunityId }: { opportunityId: string }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function onExecute() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await requestExecution(opportunityId);
      switch (result.kind) {
        case 'ok':
          if (result.body.outcome === 'created') {
            if (result.body.execution.status === 'SUCCEEDED') {
              setFeedback({
                tone: 'ok',
                message:
                  'Recovery request submitted — awaiting payment outcome. This is not a confirmed recovery.',
              });
            } else {
              setFeedback({
                tone: 'ok',
                message: `Execution recorded (status: ${result.body.execution.status}).`,
              });
            }
          } else {
            setFeedback({
              tone: 'ok',
              message: `Existing execution returned (status: ${result.body.execution.status}) — no duplicate provider call was made.`,
            });
          }
          break;
        case 'blocked':
          setFeedback({
            tone: 'warn',
            message: `Blocked by the safety policy (${result.reason}): ${result.detail}`,
          });
          break;
        case 'disabled':
        case 'unavailable':
        case 'error':
          setFeedback({ tone: 'error', message: result.message });
          break;
      }
    } finally {
      setBusy(false);
    }
  }

  const toneClasses =
    feedback?.tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : feedback?.tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-rose-200 bg-rose-50 text-rose-800';

  return (
    <div>
      <button
        type="button"
        onClick={onExecute}
        disabled={busy}
        className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy ? 'Executing…' : 'Execute Recovery'}
      </button>
      <p className="mt-2 max-w-md text-[11px] leading-relaxed text-slate-500">
        Execution is governed by the deterministic safety policy. AI advice cannot
        authorize execution.
      </p>
      {feedback && (
        <div
          className={`mt-3 max-w-xl rounded-lg border px-3 py-2 text-xs leading-relaxed ${toneClasses}`}
          role="status"
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
