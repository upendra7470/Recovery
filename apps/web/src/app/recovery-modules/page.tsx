import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatInr, formatPercent } from '@/lib/format';
import { getRecoveryModulesOverview } from '@/lib/api/recovery-modules';
import type { RecoveryModuleSummary } from '@/lib/api/recovery-modules';

export const dynamic = 'force-dynamic';

const MODULE_ICONS: Record<string, string> = {
  credit_card: '\u{1F4B3}',
  refresh_cw: '\u{1F504}',
  shield_check: '\u{1F6E1}\uFE0F',
  briefcase: '\u{1F4BC}',
  shopping_cart: '\u{1F6D2}',
  alert_triangle: '\u{26A0}\uFE0F',
};

const BADGE_COLORS: Record<string, string> = {
  indigo: 'bg-indigo-100 text-indigo-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-100 text-slate-700',
};

function ModuleCard({ mod }: { mod: RecoveryModuleSummary }) {
  const info = mod.info;
  const m = mod.metrics;
  const badgeColor = BADGE_COLORS[info.badgeTone] ?? 'bg-slate-100 text-slate-700';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">{MODULE_ICONS[info.icon] ?? '\u{1F4CA}'}</span>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{info.name}</h3>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}>
              {info.type.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">{mod.opportunitiesCount}</div>
          <div className="text-xs text-slate-500">opportunities</div>
        </div>
      </div>

      <p className="text-sm text-slate-600 mb-4 line-clamp-2">{info.description}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-900">{formatInr(m.recoverableRevenue)}</div>
          <div className="text-xs text-slate-500">Recoverable</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-emerald-600">{formatInr(m.recoveredRevenue)}</div>
          <div className="text-xs text-slate-500">Recovered</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-indigo-600">{formatPercent(m.recoveryRate)}</div>
          <div className="text-xs text-slate-500">Recovery Rate</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-amber-600">{m.blockedActions}</div>
          <div className="text-xs text-slate-500">Blocked</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
        <span>Trigger: {info.triggerEvent}</span>
        <span>Primary: {info.primaryAction}</span>
        <span>{m.humanReviews} reviews</span>
      </div>
    </div>
  );
}

export default async function RecoveryModulesPage() {
  const overview = await getRecoveryModulesOverview();

  if (!overview) {
    return (
      <div className="space-y-6">
        <PageHeader title="Recovery Modules" description="Modular revenue recovery framework — each module handles a specific type of revenue leakage." />
        <EmptyState title="Unable to load modules" message="The recovery modules API is unavailable. Start the API server to view module data." />
      </div>
    );
  }

  const { summary: s, modules } = overview;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery Modules"
        description="Modular revenue recovery framework — each module handles a specific type of revenue leakage through the shared intelligence core."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Modules" value={String(s.totalModules)} />
        <StatCard label="Total Opportunities" value={String(s.totalOpportunities)} />
        <StatCard label="Recovered Revenue" value={formatInr(s.totalRecoveredRevenue)} tone="positive" />
        <StatCard label="Recovery Rate" value={formatPercent(s.overallRecoveryRate)} tone={s.overallRecoveryRate > 50 ? 'positive' : 'neutral'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Revenue at Risk" value={formatInr(s.totalRevenueAtRisk)} tone="risk" />
        <StatCard label="Recoverable Revenue" value={formatInr(s.totalRecoverableRevenue)} />
        <StatCard label="Blocked Actions" value={String(s.totalBlockedActions)} tone={s.totalBlockedActions > 0 ? 'risk' : 'neutral'} />
        <StatCard label="Human Reviews" value={String(s.totalHumanReviews)} tone={s.totalHumanReviews > 0 ? 'neutral' : 'neutral'} />
      </div>

      <SectionCard title="Module Overview" subtitle={`${modules.length} modules registered`}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <ModuleCard key={mod.moduleType} mod={mod} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Architecture Flow" subtitle="How modules integrate with the RecoveryOS intelligence core">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {['Payment/Business Event', 'Module Detection', 'Recovery Opportunity', 'Recovery Intelligence', 'AI Decision', 'Safety/Policy Engine', 'Recovery Action', 'Outcome Verification', 'Recovery Ledger', 'Merchant Memory'].map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{step}</span>
              {i < 9 && <span className="text-slate-400">&rarr;</span>}
            </span>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
