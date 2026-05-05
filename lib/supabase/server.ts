import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types';

let cachedAdminClient: SupabaseClient<Database> | null = null;

function getSupabaseAdminEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return { supabaseUrl, supabaseServiceKey };
}

export function getSupabaseAdminClient() {
  if (cachedAdminClient) return cachedAdminClient;

  const { supabaseUrl, supabaseServiceKey } = getSupabaseAdminEnv();
  cachedAdminClient = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdminClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
