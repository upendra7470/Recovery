import type { Metadata } from 'next';
import { getDemoStatus } from '@/lib/api/demo';
import { DemoCommandCenter } from '@/components/demo/demo-command-center';
import { ModuleScenarioRunner } from '@/components/demo/module-scenario-runner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live Demo Command Center — RecoveryOS',
  description:
    'Live Revenue Recovery Command Center demonstrating automated failure detection, AI decisioning, safety policy gates, and outcome verification.',
};

export default async function DemoPage() {
  let initialStatus = null;
  try {
    initialStatus = await getDemoStatus();
  } catch {
    // API may be offline or initializing
    initialStatus = null;
  }

  return (
    <div className="space-y-6">
      <DemoCommandCenter initialStatus={initialStatus} />
      <ModuleScenarioRunner />
    </div>
  );
}
