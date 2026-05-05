"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
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
      const companyId = await getActiveCompanyId();
      // Get clients with project count
      const { data: clientsData, error } = await supabase
        .from('clients')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get project counts for each client
      const clientsWithCounts = await Promise.all(
        (clientsData || []).map(async (client) => {
          const { count } = await supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', companyId)
            .eq('client_id', client.id);
          return { ...client, project_count: count || 0 };
        })
      );

      setClients(clientsWithCounts);
    } catch (error: any) {
      console.error('Error loading clients:', error?.message || String(error));
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
    <div className="ev-page ev-page-grid min-h-screen">
      <div className="ev-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="ev-label">Accounts</p>
          <h1 className="ev-title mt-2 text-[42px]">Clients</h1>
          <p className="ev-muted mt-2 text-sm">
            Manage your clients and their projects
          </p>
        </div>
        <Link href="/clients/new">
          <Button className="ev-primary-action gap-2">
            <Plus className="h-4 w-4" />
            Add Client
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--takeoff-text-subtle)]" />
        <Input
          placeholder="Search clients..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ev-input pl-10"
        />
      </div>

      {/* Clients Grid */}
      {filteredClients.length === 0 ? (
        <Card className="ev-card">
          <CardContent className="py-16 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-[var(--takeoff-text-subtle)]" />
            <h3 className="mb-2 text-lg font-semibold text-[var(--takeoff-ink)]">
              {searchQuery ? 'No clients found' : 'No clients yet'}
            </h3>
            <p className="ev-muted mb-6">
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
              <Card className="ev-card ev-card-hover h-full">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="ev-icon-box h-12 w-12 rounded-[16px]">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <ChevronRight className="h-5 w-5 text-[var(--takeoff-text-subtle)] transition-all duration-200 group-hover:translate-x-1 group-hover:text-[var(--takeoff-accent)]" />
                  </div>

                  <h3 className="mb-3 text-lg font-semibold text-[var(--takeoff-ink)] transition-colors group-hover:text-[var(--takeoff-accent)]">
                    {client.name}
                  </h3>

                  <div className="space-y-2 text-sm">
                    {client.email && (
                      <div className="flex items-center gap-2 text-[var(--takeoff-text-muted)]">
                        <Mail className="h-4 w-4" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}
                    {client.phone && (
                      <div className="flex items-center gap-2 text-[var(--takeoff-text-muted)]">
                        <Phone className="h-4 w-4" />
                        <span>{client.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 border-t border-[var(--takeoff-line)] pt-4">
                    <div className="flex items-center gap-2 text-[var(--takeoff-text-muted)]">
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
    </div>
  );
}
