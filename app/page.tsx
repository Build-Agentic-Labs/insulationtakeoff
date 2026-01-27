"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
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
  Building2,
  Loader2,
  ArrowUpRight,
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

interface RecentClient {
  id: string;
  name: string;
  created_at: string;
  project_count: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalClients: 0,
    totalProjects: 0,
    completedQuotes: 0,
    pendingProjects: 0,
  });
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentClients, setRecentClients] = useState<RecentClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Get clients count
      const { count: clientsCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Get projects count
      const { count: projectsCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true });

      // Get completed quotes count
      const { count: completedCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');

      // Get pending projects count
      const { count: pendingCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
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
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentProjects(projectsData || []);

      // Get recent clients with project counts
      const { data: clientsData } = await supabase
        .from('clients')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (clientsData) {
        const clientsWithCounts = await Promise.all(
          clientsData.map(async (client) => {
            const { count } = await supabase
              .from('projects')
              .select('*', { count: 'exact', head: true })
              .eq('client_id', client.id);
            return { ...client, project_count: count || 0 };
          })
        );
        setRecentClients(clientsWithCounts);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'extracted':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';
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
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            Welcome back! Here's an overview of your business.
          </p>
        </div>
        <Link href="/projects/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Clients</p>
                <p className="text-3xl font-bold text-zinc-900 dark:text-white mt-1">
                  {stats.totalClients}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Projects</p>
                <p className="text-3xl font-bold text-zinc-900 dark:text-white mt-1">
                  {stats.totalProjects}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <FolderOpen className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Completed Quotes</p>
                <p className="text-3xl font-bold text-zinc-900 dark:text-white mt-1">
                  {stats.completedQuotes}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <FileCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">In Progress</p>
                <p className="text-3xl font-bold text-zinc-900 dark:text-white mt-1">
                  {stats.pendingProjects}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg">Recent Projects</CardTitle>
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="gap-1 text-primary">
                View all
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentProjects.length === 0 ? (
              <div className="text-center py-8">
                <FolderOpen className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="text-zinc-500 dark:text-zinc-400 text-sm">No projects yet</p>
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
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white group-hover:text-primary transition-colors">
                          {project.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {project.client?.name || 'No client'} • {new Date(project.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                      <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Clients */}
        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg">Recent Clients</CardTitle>
            <Link href="/clients">
              <Button variant="ghost" size="sm" className="gap-1 text-primary">
                View all
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentClients.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="text-zinc-500 dark:text-zinc-400 text-sm">No clients yet</p>
                <Link href="/clients/new">
                  <Button size="sm" className="mt-3">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Client
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentClients.map((client) => (
                  <Link
                    key={client.id}
                    href={`/clients/${client.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white group-hover:text-primary transition-colors">
                          {client.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {client.project_count} {client.project_count === 1 ? 'project' : 'projects'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="mt-6 border-zinc-200 dark:border-zinc-700 shadow-sm bg-gradient-to-r from-zinc-50 to-white dark:from-zinc-800 dark:to-zinc-900">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                Quick Actions
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                Get started with common tasks
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/clients/new">
                <Button variant="outline" className="gap-2">
                  <Users className="h-4 w-4" />
                  Add Client
                </Button>
              </Link>
              <Link href="/projects/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
