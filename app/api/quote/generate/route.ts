import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '@/lib/supabase/server';
import { QuotePDF } from '@/lib/pdf/quote-renderer';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { createSignedStorageUrl, storagePathToAppUrl } from '@/lib/supabase/storage';
import {
  calculateQuoteTotals,
  normalizeQuoteLineItems,
} from '@/lib/quotes/estimate';

export async function POST(request: NextRequest) {
  try {
    const { projectId, lineItems, taxAmount, terms, idempotencyKey: bodyIdempotencyKey } = await request.json();
    const companyId = await requireServerCompanyId();
    const idempotencyKey =
      request.headers.get('Idempotency-Key') ||
      (typeof bodyIdempotencyKey === 'string' ? bodyIdempotencyKey : null);

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    const normalizedLineItems = normalizeQuoteLineItems(lineItems);
    if (normalizedLineItems.length === 0) {
      return NextResponse.json(
        { error: 'Line items are required' },
        { status: 400 }
      );
    }

    const totals = calculateQuoteTotals(
      normalizedLineItems,
      typeof taxAmount === 'number' ? taxAmount : 0,
    );

    if (idempotencyKey) {
      const { data: existingQuote } = await supabaseAdmin
        .from('quotes')
        .select('*')
        .eq('company_id', companyId)
        .eq('project_id', projectId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existingQuote) {
        let downloadUrl: string | null = null;
        if (existingQuote.pdf_url) {
          downloadUrl = await createSignedStorageUrl(existingQuote.pdf_url, companyId, 60 * 60 * 24 * 7)
            .catch(() => null);
        }

        return NextResponse.json({
          success: true,
          cached: true,
          quote: {
            id: existingQuote.id,
            pdf_url: existingQuote.pdf_url,
            download_url: downloadUrl,
            line_items: existingQuote.line_items,
            total_cost: existingQuote.total_cost,
            total_sqft: totals.totalSf,
            quantity_label: totals.quantityLabel,
          },
        });
      }
    }

    // Get project
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('company_id', companyId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .select('name, legal_name, logo_url, address, phone, email, website, license_number, quote_terms')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { error: 'Company profile not found' },
        { status: 404 }
      );
    }

    // Calculate totals from line items
    let companyLogoUrl: string | undefined;
    if (company.logo_url) {
      try {
        companyLogoUrl = await createSignedStorageUrl(company.logo_url, companyId, 300);
      } catch (error) {
        console.warn('Unable to sign company logo for quote PDF:', error);
      }
    }

    // Generate PDF
    const pdfDoc = QuotePDF({
      projectName: project.name,
      projectDate: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      lineItems: normalizedLineItems,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalCost: totals.totalCost,
      quantityLabel: totals.quantityLabel,
      terms: typeof terms === 'string' && terms.trim() ? terms : company.quote_terms ?? undefined,
      companyName: company.name,
      companyLegalName: company.legal_name ?? undefined,
      companyAddress: company.address ?? undefined,
      companyPhone: company.phone ?? undefined,
      companyEmail: company.email ?? undefined,
      companyWebsite: company.website ?? undefined,
      companyLicenseNumber: company.license_number ?? undefined,
      companyLogoUrl,
    });

    const pdfBuffer = await renderToBuffer(pdfDoc);

    // Upload PDF to storage
    const fileName = `companies/${companyId}/quotes/${projectId}_${Date.now()}.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
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

    const pdfUrl = storagePathToAppUrl(fileName);
    const downloadUrl = await createSignedStorageUrl(fileName, companyId, 60 * 60 * 24 * 7);

    // Save quote to database
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('quotes')
      .insert({
        company_id: companyId,
        project_id: projectId,
        line_items: normalizedLineItems as any,
        total_cost: totals.totalCost,
        pdf_url: pdfUrl,
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (quoteError) {
      if (quoteError.code === '23505' && idempotencyKey) {
        const { data: racedQuote } = await supabaseAdmin
          .from('quotes')
          .select('*')
          .eq('company_id', companyId)
          .eq('project_id', projectId)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (racedQuote) {
          return NextResponse.json({
            success: true,
            cached: true,
            quote: {
              id: racedQuote.id,
              pdf_url: racedQuote.pdf_url,
              download_url: racedQuote.pdf_url
                ? await createSignedStorageUrl(racedQuote.pdf_url, companyId, 60 * 60 * 24 * 7).catch(() => null)
                : null,
              line_items: racedQuote.line_items,
              total_cost: racedQuote.total_cost,
              total_sqft: totals.totalSf,
              total_lf: totals.totalLf,
              total_ea: totals.totalEa,
              quantity_label: totals.quantityLabel,
            },
          });
        }
      }
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
      .eq('id', projectId)
      .eq('company_id', companyId);

    return NextResponse.json({
      success: true,
      quote: {
        id: quote.id,
        pdf_url: pdfUrl,
        download_url: downloadUrl,
        line_items: normalizedLineItems,
        total_cost: totals.totalCost,
        total_sqft: totals.totalSf,
        total_lf: totals.totalLf,
        total_ea: totals.totalEa,
        quantity_label: totals.quantityLabel,
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
