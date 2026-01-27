"use client";

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Users,
  FolderOpen,
  Settings,
  Home,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
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
    title: 'All Projects',
    href: '/projects',
    icon: <FolderOpen className="h-5 w-5" />,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: <Settings className="h-5 w-5" />,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-zinc-950 text-white transition-all duration-300 ease-in-out flex flex-col",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-zinc-800">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/ev-insulation-logo.jpg"
            alt="EV Insulation"
            width={36}
            height={36}
            className="rounded-lg flex-shrink-0"
          />
          <span
            className={cn(
              "font-semibold text-lg whitespace-nowrap transition-all duration-300",
              collapsed ? "opacity-0 w-0" : "opacity-100"
            )}
          >
            EV Insulation
          </span>
        </Link>
      </div>

      {/* New Project Button */}
      <div className="p-3">
        <Link href="/projects/new">
          <Button
            className={cn(
              "w-full justify-start gap-2 bg-primary hover:bg-primary/90 transition-all duration-200",
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
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group",
                isActive
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white",
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

      {/* Collapse Toggle */}
      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white transition-all duration-200",
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
