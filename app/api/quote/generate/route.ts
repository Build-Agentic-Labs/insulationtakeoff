import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '@/lib/supabase/server';
import { QuotePDF } from '@/lib/pdf/quote-renderer';

interface LineItem {
  id: string;
  area: string;
  sqft: number;
  rValue: number | null;
  pricePerSqft: number;
  totalCost: number;
}

export async function POST(request: NextRequest) {
  try {
    const { projectId, lineItems, totalCost } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json(
        { error: 'Line items are required' },
        { status: 400 }
      );
    }

    if (typeof totalCost !== 'number' || totalCost < 0) {
      return NextResponse.json(
        { error: 'Valid total cost is required' },
        { status: 400 }
      );
    }

    // Validate line items
    for (const item of lineItems as LineItem[]) {
      if (!item.area || typeof item.sqft !== 'number' || item.sqft <= 0) {
        return NextResponse.json(
          { error: `Invalid line item: ${item.area || 'unknown'}` },
          { status: 400 }
        );
      }
      if (item.rValue === null || item.rValue <= 0) {
        return NextResponse.json(
          { error: `R-value is required for ${item.area}` },
          { status: 400 }
        );
      }
    }

    // Get project
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Calculate totals from line items
    const totalSqft = (lineItems as LineItem[]).reduce((sum, item) => sum + item.sqft, 0);

    // Generate PDF
    const pdfDoc = QuotePDF({
      projectName: project.name,
      projectDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      lineItems: lineItems as LineItem[],
      totalCost,
      totalSqft,
    });

    const pdfBuffer = await renderToBuffer(pdfDoc);

    // Upload PDF to storage
    const fileName = `quotes/${projectId}_${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('pdfs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload quote PDF' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('pdfs')
      .getPublicUrl(fileName);

    const pdfUrl = urlData.publicUrl;

    // Save quote to database
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('quotes')
      .insert({
        project_id: projectId,
        line_items: lineItems,
        total_cost: totalCost,
        pdf_url: pdfUrl,
      })
      .select()
      .single();

    if (quoteError) {
      console.error('Quote save error:', quoteError);
      return NextResponse.json(
        { error: 'Failed to save quote' },
        { status: 500 }
      );
    }

    // Update project status
    await supabaseAdmin
      .from('projects')
      .update({ status: 'completed' })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      quote: {
        id: quote.id,
        pdf_url: pdfUrl,
        line_items: lineItems,
        total_cost: totalCost,
        total_sqft: totalSqft,
      },
    });
  } catch (error) {
    console.error('Quote generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
