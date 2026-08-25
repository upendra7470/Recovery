import type { NavIconName } from './nav-icon';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
}

export const navItems: readonly NavItem[] = [
  { label: 'Overview', href: '/', icon: 'overview' },
  { label: 'Recovery Cases', href: '/recovery-cases', icon: 'cases' },
  { label: 'Payment Health', href: '/payment-health', icon: 'pulse' },
  { label: 'AI Decisions', href: '/ai-decisions', icon: 'sparkles' },
  { label: 'Analytics', href: '/analytics', icon: 'chart' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];
