"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SupportDialog } from '@/components/support/SupportDialog';
import { supabase } from '@/lib/supabase/client';
import {
  Users,
  Settings,
  Home,
  ChevronLeft,
  ChevronRight,
  Plus,
  LogOut,
  UserCircle,
  Building2,
  Inbox,
  LifeBuoy,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  exact?: boolean;
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/',
    icon: <Home className="h-5 w-5" />,
  },
  {
    title: 'Clients',
    href: '/clients',
    icon: <Users className="h-5 w-5" />,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: <Settings className="h-5 w-5" />,
  },
  {
    title: 'Support',
    href: '/support/tickets',
    icon: <LifeBuoy className="h-5 w-5" />,
  },
];

const COMPANY_PROFILE_UPDATED_EVENT = 'company-profile-updated';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('Workspace');
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'member' | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserEmail(data.user?.email ?? null);
    });

    const loadCompany = async () => {
      const { data: membership } = await supabase
        .from('company_members')
        .select('company_id, role')
        .limit(1)
        .maybeSingle();

      if (!active || !membership?.company_id) return;
      setUserRole(membership.role);

      const { data: company } = await supabase
        .from('companies')
        .select('name, logo_url')
        .eq('id', membership.company_id)
        .maybeSingle();

      if (active && company) {
        if (company.name) setCompanyName(company.name);
        setCompanyLogoUrl(company.logo_url ?? null);
      }
    };

    loadCompany();

    const handleCompanyProfileUpdated = () => {
      void loadCompany();
    };
    const handleFocus = () => {
      void loadCompany();
    };

    window.addEventListener(COMPANY_PROFILE_UPDATED_EVENT, handleCompanyProfileUpdated);
    window.addEventListener('focus', handleFocus);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
      void loadCompany();
    });

    return () => {
      active = false;
      window.removeEventListener(COMPANY_PROFILE_UPDATED_EVENT, handleCompanyProfileUpdated);
      window.removeEventListener('focus', handleFocus);
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  if (pathname === '/login' || pathname === '/company/setup') {
    return null;
  }

  const visibleNavItems: NavItem[] = userRole === 'owner' || userRole === 'admin'
    ? [
      ...navItems,
      {
        title: 'Support Inbox',
        href: '/support',
        icon: <Inbox className="h-5 w-5" />,
        exact: true,
      },
    ]
    : navItems;

  return (
    <aside
      className={cn(
        "sticky left-0 top-0 z-40 flex h-screen flex-col border-r border-[rgba(216,222,212,0.14)] bg-[#0e1511] text-[#edf3ea] shadow-[14px_0_40px_rgba(10,15,12,0.2)] transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center justify-center border-b border-[rgba(216,222,212,0.12)] px-4 transition-all duration-300",
          collapsed ? "h-16" : "h-36 py-5"
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "flex-col justify-center gap-3 text-center"
          )}
        >
          <span
            className={cn(
              "flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.08]",
              collapsed ? "h-9 w-9" : "h-20 w-32"
            )}
          >
            {companyLogoUrl ? (
              <img src={companyLogoUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <Building2 className={cn("text-[#dce8d8]", collapsed ? "h-5 w-5" : "h-7 w-7")} />
            )}
          </span>
          <span
            className={cn(
              "max-w-[13rem] text-[15px] font-semibold leading-tight tracking-[-0.02em] transition-all duration-300",
              collapsed ? "opacity-0 w-0" : "opacity-100"
            )}
          >
            {companyName}
          </span>
        </Link>
      </div>

      {/* New Project Button */}
      <div className="p-3">
        <Link href="/projects/new">
          <Button
            className={cn(
              "w-full justify-start gap-2 rounded-[12px] border border-[rgba(245,248,241,0.16)] bg-[var(--takeoff-paper-strong)] text-[var(--takeoff-ink)] shadow-none transition-all duration-200 hover:bg-white",
              collapsed && "justify-center px-2"
            )}
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            <span
              className={cn(
                "transition-all duration-300",
                collapsed ? "hidden" : "block"
              )}
            >
              New Project
            </span>
          </Button>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group",
                isActive
                  ? "bg-[rgba(245,248,241,0.12)] text-white"
                  : "text-[#b6c5b5] hover:bg-[rgba(245,248,241,0.07)] hover:text-white",
                collapsed && "justify-center px-2"
              )}
            >
              <span className={cn(
                "flex-shrink-0 transition-transform duration-200",
                !isActive && "group-hover:scale-110"
              )}>
                {item.icon}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap transition-all duration-300",
                  collapsed ? "hidden" : "block"
                )}
              >
                {item.title}
              </span>
              {item.badge && !collapsed && (
                <span className="ml-auto bg-primary text-white text-xs px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={cn(
        "border-t border-[rgba(216,222,212,0.12)] p-3",
        collapsed && "px-2"
      )}>
        <div className={cn(
          "mb-2 flex items-start gap-3 rounded-lg px-3 py-2.5 text-[#b6c5b5]",
          collapsed && "justify-center px-2"
        )}>
          <UserCircle className="mt-1 h-5 w-5 shrink-0" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="takeoff-mono text-[9px] uppercase tracking-[0.18em] text-[#7f917f]">
                Signed in
              </div>
              <div className="break-all text-[12px] leading-snug text-white">
                {userEmail ?? 'Workspace user'}
              </div>
            </div>
          )}
        </div>
        <SupportDialog collapsed={collapsed} />
        <button
          onClick={handleSignOut}
          className={cn(
            "mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[#b6c5b5] transition-all duration-200 hover:bg-[rgba(245,248,241,0.07)] hover:text-white",
            collapsed && "justify-center px-2"
          )}
        >
          <LogOut className="h-5 w-5" />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[#b6c5b5] transition-all duration-200 hover:bg-[rgba(245,248,241,0.07)] hover:text-white",
            collapsed && "justify-center px-2"
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <>
              <ChevronLeft className="h-5 w-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
