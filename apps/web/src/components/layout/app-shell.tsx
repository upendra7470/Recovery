'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { LogoMark } from './logo';
import { NavIcon } from './nav-icon';
import { navItems } from './nav-items';

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-800 px-5">
        <LogoMark />
        <span className="text-base font-semibold tracking-tight text-white">
          RecoveryOS
        </span>
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
              }`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-slate-800 px-5 py-4">
        <p className="text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-emerald-400">● Demo Mode Ready</span>
          <br />
          Phase 11.2 · Command Center
        </p>
      </div>
    </div>
  );
}

function MobileSidebar({ onClose }: { onClose: () => void }) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.focus();

    return () => {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !sidebarRef.current) return;

      const focusable = sidebarRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60"
      />
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 w-64 bg-slate-900 shadow-xl outline-none"
      >
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-900 lg:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </button>
        <LogoMark />
        <span className="text-sm font-semibold tracking-tight text-slate-900">
          RecoveryOS
        </span>
      </header>

      {mobileOpen && (
        <MobileSidebar onClose={() => setMobileOpen(false)} />
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
