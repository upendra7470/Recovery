import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { DemoModeControls } from '@/components/ui/demo-mode-controls';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration for your RecoveryOS environment."
      />

      <div className="space-y-6">
        <SectionCard title="Workspace" subtitle="Environment details">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[200px_1fr]">
            <dt className="text-slate-500">Product</dt>
            <dd className="font-medium text-slate-900">RecoveryOS</dd>
            <dt className="text-slate-500">Configuration</dt>
            <dd className="text-slate-700">
              Managed via environment variables. See{' '}
              <span className="font-mono text-xs">.env.example</span> in the repository.
            </dd>
          </dl>
        </SectionCard>

        <DemoModeControls />

        <SectionCard title="Connected payment accounts" subtitle="Provider integrations">
          <EmptyState
            title="No payment accounts configured."
            message="Razorpay and other provider connections arrive in a later phase. RecoveryOS never stores payment credentials or secrets."
          />
        </SectionCard>

        <SectionCard title="Security" subtitle="Access control posture">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
            Authentication is not part of Phase 1 and will be added in a later phase.
            Until then this dashboard is intended for local development use only.
          </div>
        </SectionCard>
      </div>
    </>
  );
}
