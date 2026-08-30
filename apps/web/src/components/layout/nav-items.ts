import type { NavIconName } from './nav-icon';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
}

export const navItems: readonly NavItem[] = [
  { label: 'Live Demo', href: '/demo', icon: 'demo' },
  { label: 'Overview', href: '/', icon: 'overview' },
  { label: 'Recovery Modules', href: '/recovery-modules', icon: 'modules' },
  { label: 'Recovery Cases', href: '/recovery-cases', icon: 'cases' },
  { label: 'Recovery Operations', href: '/operations', icon: 'operations' },
  { label: 'Payment Health', href: '/payment-health', icon: 'pulse' },
  { label: 'AI Decisions', href: '/ai-decisions', icon: 'sparkles' },
  { label: 'Merchant Memory', href: '/merchant-memory', icon: 'chart' },
  { label: 'Analytics', href: '/analytics', icon: 'chart' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];
