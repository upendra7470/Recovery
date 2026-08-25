type StatTone = 'neutral' | 'risk' | 'positive';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
}

const TONE_VALUE_CLASSES: Record<StatTone, string> = {
  neutral: 'text-slate-900',
  risk: 'text-rose-600',
  positive: 'text-emerald-600',
};

export function StatCard({ label, value, hint, tone = 'neutral' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${TONE_VALUE_CLASSES[tone]}`}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}
