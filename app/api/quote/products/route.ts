import { NextRequest, NextResponse } from 'next/server';
import { requireServerCompanyId } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import {
  DEFAULT_QUOTE_PRODUCTS,
  QUOTE_PRODUCTS_SETTINGS_KEY,
  mergeQuoteProduct,
  normalizeQuoteProductInput,
  normalizeQuoteProducts,
} from '@/lib/quotes/products';

export async function GET() {
  try {
    const companyId = await requireServerCompanyId();
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('company_id', companyId)
      .eq('key', QUOTE_PRODUCTS_SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      products: normalizeQuoteProducts(data?.value ?? DEFAULT_QUOTE_PRODUCTS),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load products' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const companyId = await requireServerCompanyId();
    const body = await request.json();
    const nextProduct = normalizeQuoteProductInput(body.product);

    if (!nextProduct) {
      return NextResponse.json(
        { error: 'Product name is required' },
        { status: 400 },
      );
    }

    const { data: existingSettings, error: loadError } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('company_id', companyId)
      .eq('key', QUOTE_PRODUCTS_SETTINGS_KEY)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 });
    }

    const existingProducts = normalizeQuoteProducts(existingSettings?.value ?? DEFAULT_QUOTE_PRODUCTS);
    const products = mergeQuoteProduct(existingProducts, nextProduct);
    const nextSpec = (nextProduct.spec ?? '').toLowerCase();
    const savedProduct =
      products.find((product) =>
        product.name.toLowerCase() === nextProduct.name.toLowerCase() &&
        (product.spec ?? '').toLowerCase() === nextSpec &&
        product.unit === nextProduct.unit
      ) ??
      nextProduct;

    const { error: upsertError } = await supabaseAdmin
      .from('settings')
      .upsert(
        {
          company_id: companyId,
          key: QUOTE_PRODUCTS_SETTINGS_KEY,
          value: products as any,
        },
        { onConflict: 'company_id,key' },
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ product: savedProduct, products });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save product' },
      { status: 500 },
    );
  }
}
