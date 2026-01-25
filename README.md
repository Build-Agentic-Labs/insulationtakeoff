# Insulation Quote Generator

AI-powered web application that extracts insulation requirements from architectural PDFs and generates professional quotes.

## Features

- **PDF Upload**: Drag-and-drop PDF upload with validation
- **AI Extraction**: Claude AI automatically extracts measurements from floor plans, sections, and roof plans
- **Visual Review**: View PDF alongside extracted data with the ability to manually override values
- **Smart Calculations**: Automatic calculation of wall area, attic area, and other insulation requirements
- **Configurable Settings**: Set R-values and pricing per square foot
- **Professional Quotes**: Generate PDF quotes with line items, totals, and company branding

## Tech Stack

- **Frontend**: Next.js 14, React 19, TypeScript, Tailwind CSS, Shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **AI**: Anthropic Claude API (Vision)
- **PDF**: react-pdf (viewer), @react-pdf/renderer (generation)

## Prerequisites

- Node.js 18+ and npm
- Supabase account (free tier works)
- Anthropic API key

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Run the migration file: `supabase/migrations/001_initial_schema.sql`
4. Go to Storage and create a bucket called `pdfs` (set it to public)

### 3. Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Anthropic AI
ANTHROPIC_API_KEY="sk-ant-your-api-key"

# App Config
NEXT_PUBLIC_APP_URL="http://localhost:3000"
MAX_PDF_SIZE_MB=50
```

Find your Supabase credentials in: Project Settings → API

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage Guide

### Initial Setup

1. **Configure Settings**
   - Go to Settings page
   - Set R-values for walls, attic, garage, and floor
   - Set pricing per square foot for each area
   - Click "Save Settings"

### Creating a Quote

1. **Create New Project**
   - Click "Create New Project" on the home page
   - Enter a project name (e.g., "Lot 4 - Golden Ridge")
   - Upload an architectural PDF file
   - Click "Upload & Extract"

2. **AI Extraction**
   - The app will automatically process the PDF
   - Claude AI analyzes each page to:
     - Identify floor plans, sections, and roof plans
     - Extract square footage, dimensions, and heights
     - Store measurements in the database
   - This process takes 1-3 minutes depending on PDF size

3. **Review & Edit**
   - View the PDF alongside extracted measurements
   - Each room/area is displayed in a card with:
     - Area (sq ft)
     - Perimeter (ft)
     - Height (ft)
     - AI confidence score
     - Source page number
   - Click "Edit" to manually override any values
   - Click "Save" to store changes

4. **Generate Quote**
   - Click "Generate Quote"
   - Review the line items:
     - Living Area Walls
     - Garage Walls
     - Attic/Ceiling
     - Crawlspace/Floor (if applicable)
   - Each line shows: area, sq ft, R-value, price/sq ft, and total
   - Click "Generate Quote PDF" to create the PDF
   - Download the professional quote PDF

### Key Features

- **Automatic Calculations**:
  - Wall area = perimeter × height
  - Attic area uses extracted attic square footage or living area
  - Supports multiple room types

- **Manual Overrides**:
  - All AI-extracted values can be manually corrected
  - User overrides are saved separately in the database
  - Original extracted values are preserved

- **Professional Output**:
  - PDF includes company branding
  - Line item breakdown
  - Total cost and square footage
  - Important notes and disclaimers

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── extract/          # AI extraction endpoint
│   │   ├── quote/            # Quote generation endpoint
│   │   └── upload/           # PDF upload endpoint
│   ├── projects/
│   │   ├── [id]/
│   │   │   ├── extract/      # Extraction page
│   │   │   ├── review/       # Review & edit page
│   │   │   └── quote/        # Quote generation page
│   │   ├── new/              # New project upload
│   │   └── page.tsx          # Projects list
│   ├── settings/             # Settings page
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Landing page
├── components/
│   ├── extraction/           # Review components
│   ├── pdf/                  # PDF viewer
│   ├── ui/                   # Shadcn/ui components
│   └── upload/               # File upload
├── lib/
│   ├── ai/                   # Claude AI integration
│   ├── calculations/         # Insulation calculations
│   ├── pdf/                  # PDF processing & generation
│   └── supabase/             # Database & storage
└── supabase/
    └── migrations/           # Database schema
```

## Database Schema

- **projects**: PDF projects
- **rooms**: Extracted rooms (living, garage, attic, crawlspace)
- **measurements**: Individual measurements with AI confidence
- **quotes**: Generated quotes with line items
- **settings**: R-values and pricing configuration

## Troubleshooting

### PDF Won't Upload
- Check file size (must be under 50MB)
- Ensure file is a valid PDF
- Verify Supabase storage bucket is created and public

### Extraction Fails
- Verify Anthropic API key is set correctly
- Check API quota/limits
- Ensure PDF contains readable text and drawings

### Quote Generation Fails
- Configure R-values and pricing in Settings first
- Ensure rooms have extracted measurements
- Check that all required fields are present

### PDF Viewer Shows Black Screen
- Clear browser cache
- Try a different browser
- Check console for errors

## API Limits

- **Anthropic Claude**: Check your API tier limits
- **Supabase Free Tier**:
  - 500MB database
  - 1GB storage
  - 50,000 monthly active users

## Future Enhancements

- [ ] Multi-user authentication
- [ ] Company branding customization
- [ ] Email quote delivery
- [ ] Quote templates
- [ ] Historical quote tracking
- [ ] Excel export
- [ ] Mobile app

## License

This project is proprietary software.

## Support

For issues or questions, please contact support or refer to the documentation.
