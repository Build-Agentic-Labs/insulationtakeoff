"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Users,
  Plus,
  Search,
  Building2,
  Mail,
  Phone,
  FolderOpen,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  project_count?: number;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      // Get clients with project count
      const { data: clientsData, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get project counts for each client
      const clientsWithCounts = await Promise.all(
        (clientsData || []).map(async (client) => {
          const { count } = await supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id);
          return { ...client, project_count: count || 0 };
        })
      );

      setClients(clientsWithCounts);
    } catch (error) {
      console.error('Error loading clients:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredClients = clients.filter((client) =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.phone?.includes(searchQuery)
  );

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
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Clients</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            Manage your clients and their projects
          </p>
        </div>
        <Link href="/clients/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Client
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <Input
          placeholder="Search clients..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 border-zinc-200 dark:border-zinc-700 shadow-sm"
        />
      </div>

      {/* Clients Grid */}
      {filteredClients.length === 0 ? (
        <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm">
          <CardContent className="py-16 text-center">
            <Users className="h-12 w-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
              {searchQuery ? 'No clients found' : 'No clients yet'}
            </h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">
              {searchQuery
                ? 'Try adjusting your search query'
                : 'Get started by adding your first client'}
            </p>
            {!searchQuery && (
              <Link href="/clients/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Client
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map((client, index) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="group"
              style={{
                animationDelay: `${index * 50}ms`,
              }}
            >
              <Card className="border-zinc-200 dark:border-zinc-700 shadow-sm hover:border-primary hover:shadow-lg transition-all duration-300 h-full">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 group-hover:text-primary group-hover:translate-x-1 transition-all duration-200" />
                  </div>

                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-3 group-hover:text-primary transition-colors">
                    {client.name}
                  </h3>

                  <div className="space-y-2 text-sm">
                    {client.email && (
                      <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                        <Mail className="h-4 w-4" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                        <Phone className="h-4 w-4" />
                        <span>{client.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <FolderOpen className="h-4 w-4" />
                      <span className="text-sm">
                        {client.project_count} {client.project_count === 1 ? 'project' : 'projects'}
                      </span>
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
