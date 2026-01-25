# Supabase Setup

## Create Supabase Project

1. Go to https://supabase.com and create a free account
2. Create a new project
3. Save your project URL and API keys

## Run Migrations

1. Open the Supabase Dashboard for your project
2. Go to the SQL Editor
3. Copy and paste the contents of `migrations/001_initial_schema.sql`
4. Click "Run" to execute the migration

## Configure Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

You can find these values in your Supabase project settings under "API".

## Storage Setup

1. In Supabase Dashboard, go to Storage
2. Create a new bucket called "pdfs"
3. Set the bucket to "Public" for easier access
4. Optionally configure file size limits (recommended: 50MB)

## Database Schema

The migration creates the following tables:

- `projects` - Store uploaded PDF projects
- `rooms` - Room-level data (living, garage, attic, crawlspace)
- `measurements` - Individual measurements extracted from PDFs
- `quotes` - Generated quotes
- `settings` - Application settings (R-values, pricing)

All tables include timestamps and appropriate indexes for performance.
