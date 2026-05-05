"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Users,
  FolderOpen,
  FileCheck,
  TrendingUp,
  Plus,
  ChevronRight,
  FileText,
  Loader2,
} from 'lucide-react';

interface Stats {
  totalClients: number;
  totalProjects: number;
  completedQuotes: number;
  pendingProjects: number;
}

interface RecentProject {
  id: string;
  name: string;
  status: string;
  created_at: string;
  client: {
    name: string;
  } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalClients: 0,
    totalProjects: 0,
    completedQuotes: 0,
    pendingProjects: 0,
  });
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const companyId = await getActiveCompanyId();
      // Get clients count
      const { count: clientsCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);

      // Get projects count
      const { count: projectsCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);

      // Get completed quotes count
      const { count: completedCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'completed');

      // Get pending projects count
      const { count: pendingCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .neq('status', 'completed');

      setStats({
        totalClients: clientsCount || 0,
        totalProjects: projectsCount || 0,
        completedQuotes: completedCount || 0,
        pendingProjects: pendingCount || 0,
      });

      // Get recent projects
      const { data: projectsData } = await supabase
        .from('projects')
        .select(`
          id, name, status, created_at,
          client:clients(name)
        `)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentProjects(projectsData || []);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'ev-status-completed';
      case 'extracted':
        return 'ev-status-extracted';
      default:
        return 'ev-status-default';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="ev-page ev-page-grid min-h-screen">
      <div className="ev-container">
        {/* Header */}
        <div className="mb-5">
          <p className="ev-label">Operations</p>
          <h1 className="ev-title mt-2 text-[42px]">Dashboard</h1>
          <p className="ev-muted mt-2 text-sm">
            Welcome back! Here&apos;s an overview of your business.
          </p>
        </div>

        {/* Quick Actions */}
        <Card className="ev-panel mb-6 rounded-[22px]">
          <CardContent className="px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--takeoff-ink)]">
                  Quick Actions
                </h3>
                <p className="ev-muted mt-0.5 text-xs">
                  Add a client or start a project.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/clients/new">
                  <Button variant="outline" className="h-9 gap-2 rounded-[12px] px-4">
                    <Users className="h-4 w-4" />
                    Add Client
                  </Button>
                </Link>
                <Link href="/projects/new">
                  <Button className="ev-primary-action h-9 gap-2 rounded-[12px] px-4">
                    <Plus className="h-4 w-4" />
                    New Project
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="ev-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="ev-label">Total Clients</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--takeoff-ink)]">
                    {stats.totalClients}
                  </p>
                </div>
                <div className="ev-icon-box h-12 w-12 rounded-[16px]">
                  <Users className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="ev-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="ev-label">Total Projects</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--takeoff-ink)]">
                    {stats.totalProjects}
                  </p>
                </div>
                <div className="ev-icon-box h-12 w-12 rounded-[16px]">
                  <FolderOpen className="h-6 w-6 text-[#47644a]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="ev-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="ev-label">Completed Quotes</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--takeoff-ink)]">
                    {stats.completedQuotes}
                  </p>
                </div>
                <div className="ev-icon-box h-12 w-12 rounded-[16px]">
                  <FileCheck className="h-6 w-6 text-[#6f8b5e]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="ev-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="ev-label">In Progress</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--takeoff-ink)]">
                    {stats.pendingProjects}
                  </p>
                </div>
                <div className="ev-icon-box h-12 w-12 rounded-[16px]">
                  <TrendingUp className="h-6 w-6 text-[var(--takeoff-warning)]" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Projects */}
        <Card className="ev-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Recent Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {recentProjects.length === 0 ? (
              <div className="text-center py-8">
                <FolderOpen className="mx-auto mb-3 h-10 w-10 text-[var(--takeoff-text-subtle)]" />
                <p className="ev-muted text-sm">No projects yet</p>
                <Link href="/projects/new">
                  <Button size="sm" className="mt-3">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Project
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group flex items-center justify-between rounded-[18px] p-3 transition-colors hover:bg-[var(--takeoff-paper)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="ev-icon-box h-10 w-10 rounded-[14px]">
                        <FileText className="h-5 w-5 text-[var(--takeoff-accent)]" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--takeoff-ink)] transition-colors group-hover:text-[var(--takeoff-accent)]">
                          {project.name}
                        </p>
                        <p className="text-xs text-[var(--takeoff-text-muted)]">
                          {project.client?.name || 'No client'} • {new Date(project.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`ev-status ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                      <ChevronRight className="h-4 w-4 text-[var(--takeoff-text-subtle)] transition-all group-hover:translate-x-1 group-hover:text-[var(--takeoff-accent)]" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
