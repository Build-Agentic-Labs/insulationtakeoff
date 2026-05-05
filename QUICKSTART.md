# Quick Start Guide

Get your Insulation Quote Generator running in 5 minutes!

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Setup Supabase

1. Go to [supabase.com](https://supabase.com) and sign up/log in
2. Click "New Project"
3. Fill in project details:
   - Name: `insulation-quote-generator`
   - Database Password: (choose a strong password)
   - Region: (choose closest to you)
4. Wait for the project to be created (1-2 minutes)

### Setup Database

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Open `supabase/migrations/001_initial_schema.sql` in this project
4. Copy all the SQL code and paste into the Supabase SQL editor
5. Click "Run" to execute the migration

### Setup Storage

1. In Supabase dashboard, go to **Storage**
2. Click "Create a new bucket"
3. Name: `pdfs`
4. Make it **Public**
5. Click "Create bucket"

## Step 3: Get API Keys

### Supabase Keys

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy these values:
   - Project URL
   - `anon` `public` key
   - `service_role` `secret` key

### Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up/log in
3. Go to **API Keys**
4. Click "Create Key"
5. Copy the API key (starts with `sk-ant-`)

## Step 4: Configure Environment

Edit the `.env.local` file in the project root:

```env
# Paste your Supabase Project URL
NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"

# Paste your Supabase anon key
NEXT_PUBLIC_SUPABASE_ANON_KEY="<your-supabase-anon-key>"

# Paste your Supabase service_role key
SUPABASE_SERVICE_ROLE_KEY="<your-supabase-service-role-key>"

# Paste your Anthropic API key
ANTHROPIC_API_KEY="<your-anthropic-api-key>"

# Leave these as-is
NEXT_PUBLIC_APP_URL="http://localhost:3000"
MAX_PDF_SIZE_MB=50
```

## Step 5: Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Step 6: Configure R-Values & Pricing

1. Click "Settings" in the navigation
2. Fill in R-values:
   - Wall R-Value: `15` (or your preferred value)
   - Attic/Ceiling R-Value: `38`
   - Garage Wall R-Value: `13`
   - Floor/Crawlspace R-Value: `19`
3. Fill in pricing:
   - Wall Price: `1.50` ($/sq ft)
   - Attic Price: `2.00`
   - Garage Wall Price: `1.75`
   - Floor Price: `2.50`
4. Click "Save Settings"

## Step 7: Test with Sample PDF

1. Use the included `Lot 4-Golden Ridge - Cohen.pdf` or your own architectural PDF
2. Click "Create New Project"
3. Enter project name: `Test Project`
4. Upload the PDF
5. Click "Upload & Extract"
6. Wait 1-3 minutes for AI extraction
7. Review and edit measurements if needed
8. Click "Generate Quote"
9. Download your PDF quote!

## Troubleshooting

### "Missing Supabase environment variables"
- Make sure you've filled in all values in `.env.local`
- Restart the dev server after editing `.env.local`

### "Failed to upload PDF"
- Check that you created the `pdfs` bucket in Supabase Storage
- Ensure the bucket is set to Public

### "Extraction failed"
- Verify your Anthropic API key is correct
- Check that you have API credits available
- Ensure the PDF contains readable architectural drawings

### Build errors
- Delete `.next` folder and `node_modules`
- Run `npm install` again
- Try `npm run dev` again

## Next Steps

- Customize company branding in `lib/pdf/quote-renderer.tsx`
- Add more room types if needed
- Adjust pricing and R-values as needed
- Test with different PDF files

## Support

If you encounter issues:

1. Check the error message in the browser console (F12)
2. Review the README.md for detailed documentation
3. Check Supabase logs in the dashboard
4. Verify all environment variables are set correctly

Happy quoting!
