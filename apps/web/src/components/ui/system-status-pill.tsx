interface SystemStatusPillProps {
  connected: boolean;
}

export function SystemStatusPill({ connected }: SystemStatusPillProps) {
  const style = connected
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
  const dotStyle = connected ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}
      role="status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyle}`} aria-hidden="true" />
      {connected ? 'API connected' : 'API unreachable'}
    </span>
  );
}
