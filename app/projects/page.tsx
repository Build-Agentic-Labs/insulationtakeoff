"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  FileText,
  Plus,
  Search,
  FolderOpen,
  Building2,
  ChevronRight,
  Loader2,
  Filter,
  PenLine,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  status: string;
  created_at: string;
  client_id: string | null;
  client: {
    id: string;
    name: string;
  } | null;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          client:clients(id, name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProjects = projects.filter((project) => {
    const matchesSearch =
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || project.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'extracted':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'manual':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      default:
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';
    }
  };

  const statuses = ['uploaded', 'extracted', 'completed', 'manual'];

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
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">All Projects</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            {projects.length} total projects
          </p>
        </div>
        <Link href="/projects/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            placeholder="Search projects or clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 border-zinc-200 dark:border-zinc-700 shadow-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={statusFilter === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(null)}
          >
            All
          </Button>
          {statuses.map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
              className="capitalize"
            >
              {status}
            </Button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      {filteredProjects.length === 0 ? (
        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="py-16 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
              {searchQuery || statusFilter ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">
              {searchQuery || statusFilter
                ? 'Try adjusting your filters'
                : 'Get started by creating your first project'}
            </p>
            {!searchQuery && !statusFilter && (
              <Link href="/projects/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Project
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredProjects.map((project, index) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group block"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm hover:border-primary hover:shadow-md transition-all duration-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        project.status === 'manual'
                          ? 'bg-purple-100 dark:bg-purple-900/30'
                          : 'bg-red-100 dark:bg-red-900/30'
                      }`}>
                        {project.status === 'manual' ? (
                          <PenLine className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                        ) : (
                          <FileText className="h-6 w-6 text-red-600 dark:text-red-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-white group-hover:text-primary transition-colors">
                          {project.name}
                        </h3>
                        <div className="flex items-center gap-3 mt-1">
                          {project.client && (
                            <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>{project.client.name}</span>
                            </div>
                          )}
                          <span className="text-sm text-zinc-400">
                            {new Date(project.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                      <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 group-hover:text-primary group-hover:translate-x-1 transition-all duration-200" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
