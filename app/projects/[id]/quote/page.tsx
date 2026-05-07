"use client";

import { Fragment, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getActiveCompanyId } from '@/lib/supabase/company';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/calculations/pricing';
import { AlertCircle, ArrowLeft, Download, FileText, Loader2, Mail, Plus, Trash2 } from 'lucide-react';
import type { TakeoffEnvelopeV1 } from '@/lib/types/takeoff-envelope';
import { resolveActiveMode } from '@/lib/extraction/resolveActiveMode';
import {
  ESTIMATE_GROUP_SECTION_TITLE,
  calculateQuoteTotals,
  normalizeQuoteLineItems,
  parseRValueNumber,
  roundEstimateValue,
  sanitizeEstimateRows,
  type EstimateGroup,
  type EstimateUnit,
  type EstimateWorksheetRow,
  type QuoteLineItem,
} from '@/lib/quotes/estimate';
import {
  buildSuggestedAreasFromWorkspaceSummary,
  getPreferredWorkspaceSummary,
  mapTakeoffSessionRowToSession,
  type TakeoffSessionRowLike,
} from '@/lib/takeoff/workspace-v2';
import { getProjectWorkspaceHref, resolveQuoteReviewHref } from '@/lib/takeoff/navigation';
import { getProjectRefColumn, getProjectRouteRef } from '@/lib/projects/slug';
import {
  DEFAULT_QUOTE_PRODUCTS,
  normalizeQuoteProducts,
  type QuoteProduct,
} from '@/lib/quotes/products';

interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
}

interface ProjectRecord {
  id: string;
  slug?: string | null;
  name: string;
  active_extraction_mode?: 'ocr' | 'vision' | null;
}

interface ExtractionRunRecord {
  id: string;
  mode: 'ocr' | 'vision' | 'hybrid' | null;
  status: string | null;
  finished_at: string | null;
  takeoff_envelope?: unknown;
}

interface QuoteRecord {
  id: string;
  pdf_url: string | null;
  download_url?: string | null;
  line_items: QuoteLineItem[] | null;
  total_cost?: number | null;
}

interface InsulationArea {
  id: string;
  name: string;
  productId?: string | null;
  productType?: string | null;
  description: string;
  enabled: boolean;
  rValue: number | null;
  sqft: number;
  unit: EstimateUnit;
  pricePerSqft: number;
  isCustom?: boolean;
  group: EstimateGroup;
  spec?: string | null;
}

interface GlobalPricing {
  wall_per_sqft: number;
  attic_per_sqft: number;
  garage_wall_per_sqft: number;
  floor_per_sqft: number;
}

interface ProductDraft {
  name: string;
  group: EstimateGroup;
  unit: EstimateUnit;
  defaultPrice: string;
  spec: string;
}

type EstimateSectionKey = 'walls' | 'ceilings' | 'floors' | 'specialty' | 'services' | 'custom';

const DEFAULT_PRICING: GlobalPricing = {
  wall_per_sqft: 1.5,
  attic_per_sqft: 1.25,
  garage_wall_per_sqft: 1.75,
  floor_per_sqft: 2.0,
};

const ESTIMATE_SECTIONS: Array<{
  key: EstimateSectionKey;
  code: string;
  title: string;
  description: string;
}> = [
  {
    key: 'walls',
    code: '01',
    title: 'Wall Assemblies',
    description: 'Exterior, garage, basement, and knee-wall insulation scope.',
  },
  {
    key: 'ceilings',
    code: '02',
    title: 'Ceilings & Attics',
    description: 'Attic and ceiling insulation taken from traced scope.',
  },
  {
    key: 'floors',
    code: '03',
    title: 'Floors & Crawlspaces',
    description: 'Floor-area and crawlspace scope taken from traced zones.',
  },
  {
    key: 'specialty',
    code: '04',
    title: 'Specialty Scope',
    description: 'Rim joists and non-standard scope items.',
  },
  {
    key: 'services',
    code: '05',
    title: 'Services & Tests',
    description: 'Testing, sealing, duct wrapping, baffles, and other non-area services.',
  },
  {
    key: 'custom',
    code: '06',
    title: 'Manual Additions',
    description: 'Estimator-added rows that are not seeded directly from takeoff.',
  },
];

const SECTION_BY_AREA_ID: Record<string, EstimateSectionKey> = {
  exterior_walls: 'walls',
  garage_walls: 'walls',
  basement_walls: 'walls',
  knee_walls: 'walls',
  attic_ceiling: 'ceilings',
  cathedral_ceiling: 'ceilings',
  garage_ceiling: 'ceilings',
  crawlspace_floor: 'floors',
  floor_insulation: 'floors',
  sound_floor: 'floors',
  cantilever_floor: 'floors',
  rim_joist: 'specialty',
};

const SECTION_KEY_BY_GROUP: Record<EstimateGroup, EstimateSectionKey> = {
  Walls: 'walls',
  Ceilings: 'ceilings',
  Floors: 'floors',
  Specialty: 'specialty',
  Services: 'services',
  Custom: 'custom',
};

const GROUP_BY_SECTION_KEY: Record<EstimateSectionKey, EstimateGroup> = {
  walls: 'Walls',
  ceilings: 'Ceilings',
  floors: 'Floors',
  specialty: 'Specialty',
  services: 'Services',
  custom: 'Custom',
};

const ESTIMATE_GROUP_OPTIONS: EstimateGroup[] = ['Walls', 'Ceilings', 'Floors', 'Specialty', 'Services', 'Custom'];
const ESTIMATE_UNIT_OPTIONS: EstimateUnit[] = ['SF', 'LF', 'EA'];

function formatEditableNumber(value: number, precision: number = 2): string {
  const rounded = roundEstimateValue(value, precision);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function productMatchesGroup(product: QuoteProduct, group: EstimateGroup) {
  return product.group === group || group === 'Custom';
}

function applyProductToArea(area: InsulationArea, product: QuoteProduct) {
  return {
    ...area,
    productId: product.id,
    productType: product.name,
    unit: product.unit,
    pricePerSqft: product.defaultPrice > 0 ? product.defaultPrice : area.pricePerSqft,
    spec: product.spec ?? area.spec,
  };
}

function findProductForArea(
  area: Pick<InsulationArea, 'productId' | 'productType' | 'group' | 'spec'>,
  products: QuoteProduct[],
) {
  if (area.productId) {
    const byId = products.find((product) => product.id === area.productId);
    if (byId) return byId;
  }

  const productType = area.productType?.trim().toLowerCase();
  if (productType) {
    const spec = area.spec?.trim().toLowerCase();
    const byName = products.find((product) =>
      product.name.toLowerCase() === productType &&
      (!spec || (product.spec ?? '').toLowerCase() === spec)
    );
    if (byName) return byName;
  }

  return products.find((product) => productMatchesGroup(product, area.group)) ?? null;
}

function withDefaultProduct(area: InsulationArea, products: QuoteProduct[]) {
  const product = findProductForArea(area, products);
  if (!product) return area;

  return {
    ...area,
    productId: area.productId ?? product.id,
    productType: area.productType ?? product.name,
    spec: area.spec ?? product.spec ?? null,
  };
}

function buildProductDraft(area?: InsulationArea): ProductDraft {
  return {
    name: '',
    group: area?.group ?? 'Walls',
    unit: area?.unit ?? 'SF',
    defaultPrice: area ? formatEditableNumber(area.pricePerSqft) : '',
    spec: area?.spec ?? '',
  };
}

function formatLineDescriptor(area: InsulationArea): string | null {
  const parts: string[] = [];
  if (area.productType && area.name && area.name.trim() !== area.productType.trim()) {
    parts.push(area.name.trim());
  }

  const spec = area.spec?.trim();
  if (spec) {
    parts.push(spec);
  }
  if (area.rValue !== null && area.rValue > 0) {
    const rValue = `R-${area.rValue}`;
    const rValuePattern = new RegExp(`\\bR\\s*-?\\s*${area.rValue}\\b`, 'i');
    if (!parts.some((part) => rValuePattern.test(part))) {
      parts.push(rValue);
    }
  }
  const cleanedDescription = area.description?.trim();
  if (
    cleanedDescription &&
    cleanedDescription.toLowerCase() !== 'custom line item' &&
    !parts.includes(cleanedDescription)
  ) {
    parts.push(cleanedDescription);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function getSectionForArea(area: InsulationArea) {
  const key: EstimateSectionKey = area.group
    ? SECTION_KEY_BY_GROUP[area.group]
    : area.isCustom
    ? 'custom'
    : SECTION_BY_AREA_ID[area.id] ?? 'specialty';
  return ESTIMATE_SECTIONS.find((section) => section.key === key)!;
}

function getDefaultPriceForGroup(group: EstimateGroup, pricing: GlobalPricing): number {
  switch (group) {
    case 'Ceilings':
      return pricing.attic_per_sqft;
    case 'Floors':
    case 'Specialty':
      return pricing.floor_per_sqft;
    case 'Walls':
      return pricing.wall_per_sqft;
    case 'Services':
    case 'Custom':
    default:
      return 0;
  }
}

function estimateRowsToInsulationAreas(
  estimateRows: EstimateWorksheetRow[],
  pricing: GlobalPricing,
  products: QuoteProduct[],
): InsulationArea[] {
  return estimateRows.map((row) =>
    withDefaultProduct({
      id: row.id,
      name: row.label,
      description: row.note || ESTIMATE_GROUP_SECTION_TITLE[row.group],
      enabled: row.enabled,
      rValue: parseRValueNumber(row.spec),
      sqft: roundEstimateValue(row.quantity, 1),
      unit: row.unit,
      pricePerSqft: roundEstimateValue(getDefaultPriceForGroup(row.group, pricing)),
      isCustom: row.source === 'manual',
      group: row.group,
      spec: row.spec || null,
    }, products)
  );
}

function quoteLineItemsToInsulationAreas(
  lineItems: unknown,
  products: QuoteProduct[],
): InsulationArea[] {
  return normalizeQuoteLineItems(lineItems).map((item) => {
    const sectionKey =
      ESTIMATE_SECTIONS.find((section) => section.title === item.section)?.key ?? 'custom';
    const group = GROUP_BY_SECTION_KEY[sectionKey];

    return withDefaultProduct({
      id: item.id,
      name: item.area,
      productId: item.productId ?? null,
      productType: item.productType ?? null,
      description: item.notes || 'Generated quote line item',
      enabled: true,
      rValue: item.rValue,
      sqft: roundEstimateValue(item.quantity, 1),
      unit: item.unit,
      pricePerSqft: roundEstimateValue(item.pricePerUnit),
      isCustom: item.isCustom,
      group,
      spec: item.spec ?? null,
    }, products);
  });
}

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectRef } = use(params);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insulationAreas, setInsulationAreas] = useState<InsulationArea[]>([]);
  const [productCatalog, setProductCatalog] = useState<QuoteProduct[]>(DEFAULT_QUOTE_PRODUCTS);
  const [addingProductForAreaId, setAddingProductForAreaId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(() => buildProductDraft());
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [reviewHref, setReviewHref] = useState(getProjectWorkspaceHref(projectRef));
  const [taxAmount, setTaxAmount] = useState(0);
  const [terms, setTerms] = useState(
    'Final field measurements will be verified before installation. Pricing includes labor and standard insulation materials unless noted otherwise.'
  );

  const initializeInsulationAreas = useCallback((
    loadedRooms: Room[],
    pricing: GlobalPricing,
    products: QuoteProduct[],
    sources?: {
      workspaceSummary?: ReturnType<typeof getPreferredWorkspaceSummary>;
      envelope?: TakeoffEnvelopeV1 | null;
    }
  ) => {
    const areas: InsulationArea[] = [];
    const envelope = sources?.envelope ?? null;

    const addArea = (
      area: Omit<InsulationArea, 'unit' | 'group'> & Partial<Pick<InsulationArea, 'unit' | 'group'>>,
    ) => {
      if (!areas.some((existing) => existing.id === area.id)) {
        const sectionKey = SECTION_BY_AREA_ID[area.id] ?? 'custom';
        areas.push({
          ...area,
          sqft: roundEstimateValue(area.sqft),
          pricePerSqft: roundEstimateValue(area.pricePerSqft),
          unit: area.unit ?? 'SF',
          group: area.group ?? GROUP_BY_SECTION_KEY[sectionKey],
        } satisfies InsulationArea);
        areas[areas.length - 1] = withDefaultProduct(areas[areas.length - 1], products);
      }
    };

    for (const area of buildSuggestedAreasFromWorkspaceSummary(sources?.workspaceSummary, pricing)) {
      addArea({
        ...area,
        rValue: null,
        unit: area.unit,
      });
    }

    const livingRooms = loadedRooms.filter((room) => room.type === 'living');
    const totalLivingArea = livingRooms.reduce((sum, room) => sum + (room.area_sqft || 0), 0);

    let livingWallArea = 0;
    for (const room of livingRooms) {
      if (room.perimeter_ft && room.height_ft) {
        livingWallArea += room.perimeter_ft * room.height_ft;
      }
    }

    const envCeiling = envelope?.summary?.estimated_ceiling_sf || 0;
    const ceilingStatus = envelope?.completeness?.ceiling_area || 'missing';
    const atticRooms = loadedRooms.filter((room) => room.type === 'attic');
    const totalAtticArea = atticRooms.reduce((sum, room) => sum + (room.area_sqft || 0), 0);
    const ceilingArea =
      envCeiling > 0 ? envCeiling : totalAtticArea > 0 ? totalAtticArea : totalLivingArea;

    if (ceilingArea > 0) {
      addArea({
        id: 'attic_ceiling',
        name: envCeiling > 0 ? 'Attic / Ceiling Insulation' : 'Attic / Ceiling Insulation',
        description:
          envCeiling > 0
            ? `${Math.round(ceilingArea).toLocaleString()} SF from takeoff extraction (${ceilingStatus})`
            : `${Math.round(ceilingArea).toLocaleString()} SF of ceiling area`,
        enabled: envCeiling > 0 ? ceilingStatus !== 'missing' : true,
        rValue: null,
        sqft: ceilingArea,
        pricePerSqft: pricing.attic_per_sqft,
      });
    }

    const envNetWallSF = envelope?.summary?.net_sf || 0;
    const envGrossWallSF = envelope?.summary?.gross_sf || 0;
    const wallStatus = envelope?.completeness?.net_sf || 'missing';
    if (envNetWallSF > 0) {
      addArea({
        id: 'exterior_walls',
        name: 'Exterior Walls',
        description: `${Math.round(envNetWallSF).toLocaleString()} SF net (${Math.round(
          envGrossWallSF
        ).toLocaleString()} gross less openings)`,
        enabled: wallStatus === 'final',
        rValue: null,
        sqft: envNetWallSF,
        pricePerSqft: pricing.wall_per_sqft,
      });
    } else if (livingWallArea > 0) {
      addArea({
        id: 'exterior_walls',
        name: 'Exterior Walls',
        description: `${Math.round(livingWallArea).toLocaleString()} SF of wall area`,
        enabled: true,
        rValue: null,
        sqft: livingWallArea,
        pricePerSqft: pricing.wall_per_sqft,
      });
    } else if (totalLivingArea > 0) {
      addArea({
        id: 'exterior_walls',
        name: 'Exterior Walls',
        description: 'Wall quantity not seeded because no verified wall height was found.',
        enabled: false,
        rValue: null,
        sqft: 0,
        pricePerSqft: pricing.wall_per_sqft,
      });
    }

    const garageRooms = loadedRooms.filter((room) => room.type === 'garage');
    const totalGarageArea = garageRooms.reduce((sum, room) => sum + (room.area_sqft || 0), 0);

    let garageWallArea = 0;
    for (const room of garageRooms) {
      if (room.perimeter_ft && room.height_ft) {
        garageWallArea += room.perimeter_ft * room.height_ft;
      }
    }

    if (garageWallArea > 0) {
      addArea({
        id: 'garage_walls',
        name: 'Garage Walls',
        description: `${Math.round(garageWallArea).toLocaleString()} SF of garage wall area`,
        enabled: false,
        rValue: null,
        sqft: garageWallArea,
        pricePerSqft: pricing.garage_wall_per_sqft,
      });
    } else if (totalGarageArea > 0) {
      addArea({
        id: 'garage_walls',
        name: 'Garage Walls',
        description: 'Garage wall quantity not seeded because no verified wall height was found.',
        enabled: false,
        rValue: null,
        sqft: 0,
        pricePerSqft: pricing.garage_wall_per_sqft,
      });
    }

    const envCrawlspace = envelope?.summary?.estimated_crawlspace_sf || 0;
    const crawlspaceStatus = envelope?.completeness?.crawlspace_area || 'missing';
    const crawlspaceRooms = loadedRooms.filter((room) => room.type === 'crawlspace');
    const totalCrawlspaceArea = crawlspaceRooms.reduce((sum, room) => sum + (room.area_sqft || 0), 0);

    if (envCrawlspace > 0) {
      addArea({
        id: 'crawlspace_floor',
        name: 'Crawlspace / Floor Insulation',
        description: `${Math.round(envCrawlspace).toLocaleString()} SF from takeoff extraction (${crawlspaceStatus})`,
        enabled: crawlspaceStatus !== 'missing',
        rValue: null,
        sqft: envCrawlspace,
        pricePerSqft: pricing.floor_per_sqft,
      });
    } else if (totalCrawlspaceArea > 0) {
      addArea({
        id: 'crawlspace_floor',
        name: 'Crawlspace / Floor Insulation',
        description: `${Math.round(totalCrawlspaceArea).toLocaleString()} SF of floor area`,
        enabled: false,
        rValue: null,
        sqft: totalCrawlspaceArea,
        pricePerSqft: pricing.floor_per_sqft,
      });
    } else if (totalLivingArea > 0) {
      addArea({
        id: 'crawlspace_floor',
        name: 'Floor Insulation',
        description: `${Math.round(totalLivingArea).toLocaleString()} SF based on living area`,
        enabled: false,
        rValue: null,
        sqft: totalLivingArea,
        pricePerSqft: pricing.floor_per_sqft,
      });
    }

    const envGarageCeiling = envelope?.summary?.estimated_garage_ceiling_sf || 0;
    if (envGarageCeiling > 0) {
      addArea({
        id: 'garage_ceiling',
        name: 'Garage Ceiling Insulation',
        description: `${Math.round(envGarageCeiling).toLocaleString()} SF from takeoff extraction`,
        enabled: false,
        rValue: null,
        sqft: envGarageCeiling,
        pricePerSqft: pricing.attic_per_sqft,
      });
    }

    const envRimJoist = envelope?.summary?.estimated_rim_joist_lf || 0;
    if (envRimJoist > 0) {
      addArea({
        id: 'rim_joist',
        name: 'Rim Joist Insulation',
        description: `${Math.round(envRimJoist).toLocaleString()} LF from takeoff extraction`,
        enabled: false,
        rValue: null,
        sqft: envRimJoist,
        unit: 'LF',
        pricePerSqft: pricing.floor_per_sqft,
      });
    }

    setInsulationAreas(areas);
  }, []);

  const restoreFromQuote = useCallback((lineItems: unknown, products: QuoteProduct[]) => {
    setInsulationAreas(quoteLineItemsToInsulationAreas(lineItems, products));
  }, []);

  const loadData = useCallback(async () => {
    try {
      const companyId = await getActiveCompanyId();
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq(getProjectRefColumn(projectRef), projectRef)
        .eq('company_id', companyId)
        .single();

      const loadedProject = (projectData as ProjectRecord | null) ?? null;
      const projectId = loadedProject?.id;
      const projectRouteRef = loadedProject ? getProjectRouteRef(loadedProject) : projectRef;
      setProject(loadedProject);

      if (!projectId) {
        throw new Error('Project not found');
      }

      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .eq('project_id', projectId)
        .eq('company_id', companyId);

      const loadedRooms = roomsData || [];

      const { data: pricingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pricing')
        .eq('company_id', companyId)
        .single();

      const pricing = (pricingData?.value || DEFAULT_PRICING) as GlobalPricing;
      let products = DEFAULT_QUOTE_PRODUCTS;
      try {
        const productsResponse = await fetch('/api/quote/products');
        if (productsResponse.ok) {
          const productsData = await productsResponse.json();
          products = normalizeQuoteProducts(productsData.products);
        }
      } catch (productLoadError) {
        console.warn('Unable to load quote products:', productLoadError);
      }
      setProductCatalog(products);

      const { data: takeoffSessionData } = await supabase
        .from('takeoff_sessions')
        .select('*')
        .eq('project_id', projectId)
        .eq('company_id', companyId)
        .in('status', ['in_progress', 'calibrating', 'tracing', 'reviewing', 'completed'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const takeoffSession = takeoffSessionData
        ? mapTakeoffSessionRowToSession(takeoffSessionData as TakeoffSessionRowLike)
        : null;
      const quoteSource =
        typeof window === 'undefined'
          ? null
          : new URLSearchParams(window.location.search).get('source');
      setReviewHref(resolveQuoteReviewHref(projectRouteRef, {
        source: quoteSource,
        hasTakeoffSession: Boolean(takeoffSession),
      }));
      const workspaceSummary = getPreferredWorkspaceSummary(takeoffSession);
      const estimateRows = sanitizeEstimateRows(takeoffSession?.estimateRows);

      const { data: runsData } = await supabase
        .from('extraction_runs')
        .select('id, mode, status, finished_at, takeoff_envelope')
        .eq('project_id', projectId)
        .eq('company_id', companyId)
        .order('finished_at', { ascending: false });

      const { data: docsData } = await supabase
        .from('documents')
        .select('takeoff_envelope')
        .eq('project_id', projectId)
        .eq('company_id', companyId)
        .not('takeoff_envelope', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const hasDocEnvelope = !!docsData?.[0]?.takeoff_envelope;
      const runsTyped = (runsData || []) as ExtractionRunRecord[];

      const resolution = resolveActiveMode({
        persistedMode: (projectData as ProjectRecord | null)?.active_extraction_mode || null,
        runs: runsTyped.flatMap((run) =>
          run.mode
            ? [
                {
                  id: run.id,
                  mode: run.mode,
                  status: run.status ?? '',
                  finished_at: run.finished_at,
                },
              ]
            : []
        ),
        hasEnvelope:
          hasDocEnvelope ||
          runsTyped.some((run) => (run.mode === 'ocr' || run.mode === 'hybrid') && run.takeoff_envelope),
        hasRooms: loadedRooms.length > 0,
      });

      let loadedEnvelope: TakeoffEnvelopeV1 | null = null;
      if (resolution.mode === 'ocr' && resolution.activeRun) {
        const activeRunData = runsTyped.find((run) => run.id === resolution.activeRun!.id);
        if (activeRunData?.takeoff_envelope) {
          loadedEnvelope = activeRunData.takeoff_envelope as unknown as TakeoffEnvelopeV1;
        }
      }
      if (!loadedEnvelope && resolution.mode === 'ocr' && hasDocEnvelope) {
        loadedEnvelope = docsData![0].takeoff_envelope as unknown as TakeoffEnvelopeV1;
      }

      if (estimateRows.length > 0) {
        setInsulationAreas(estimateRowsToInsulationAreas(estimateRows, pricing, products));
      } else {
        initializeInsulationAreas(loadedRooms, pricing, products, {
          workspaceSummary,
          envelope: resolution.mode === 'ocr' ? loadedEnvelope : null,
        });
      }

      const { data: quoteData } = await supabase
        .from('quotes')
        .select('*')
        .eq('project_id', projectId)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (quoteData) {
        const normalizedQuote = quoteData as QuoteRecord;
        setQuote(normalizedQuote);
        const storedLineItems = normalizedQuote.line_items as unknown;
        if (Array.isArray(storedLineItems)) {
          restoreFromQuote(storedLineItems, products);
        }
      }
    } catch (loadError) {
      console.error('Error loading quote data:', loadError);
    } finally {
      setIsLoading(false);
    }
  }, [projectRef, initializeInsulationAreas, restoreFromQuote]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleArea = (areaId: string) => {
    setInsulationAreas((previous) =>
      previous.map((area) =>
        area.id === areaId ? { ...area, enabled: !area.enabled } : area
      )
    );
  };

  const updateName = (areaId: string, value: string) => {
    setInsulationAreas((previous) =>
      previous.map((area) => (area.id === areaId ? { ...area, name: value } : area))
    );
  };

  const updateProduct = (areaId: string, productId: string) => {
    const product = productCatalog.find((candidate) => candidate.id === productId);
    if (!product) return;

    setInsulationAreas((previous) =>
      previous.map((area) =>
        area.id === areaId
          ? applyProductToArea(area, product)
          : area
      )
    );
  };

  const startAddingProduct = (area: InsulationArea) => {
    setProductDraft(buildProductDraft(area));
    setProductError(null);
    setAddingProductForAreaId(area.id);
  };

  const cancelAddingProduct = () => {
    setAddingProductForAreaId(null);
    setProductDraft(buildProductDraft());
    setProductError(null);
  };

  const saveProduct = async (areaId: string) => {
    const name = productDraft.name.trim();
    const defaultPrice = roundEstimateValue(parseFloat(productDraft.defaultPrice) || 0);

    if (!name) {
      setProductError('Product name is required.');
      return;
    }

    setIsSavingProduct(true);
    setProductError(null);

    try {
      const response = await fetch('/api/quote/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            name,
            group: productDraft.group,
            unit: productDraft.unit,
            defaultPrice,
            spec: productDraft.spec,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save product.');
      }

      const products = normalizeQuoteProducts(data.products);
      const draftSpec = productDraft.spec.trim().toLowerCase();
      const savedProduct =
        products.find((product) =>
          product.name.toLowerCase() === name.toLowerCase() &&
          (product.spec ?? '').toLowerCase() === draftSpec &&
          product.unit === productDraft.unit
        ) ??
        data.product;
      setProductCatalog(products);

      if (savedProduct) {
        setInsulationAreas((previous) =>
          previous.map((area) =>
            area.id === areaId
              ? applyProductToArea(area, savedProduct)
              : area
          )
        );
      }

      cancelAddingProduct();
    } catch (saveError) {
      setProductError(saveError instanceof Error ? saveError.message : 'Failed to save product.');
    } finally {
      setIsSavingProduct(false);
    }
  };

  const updateSqft = (areaId: string, value: string) => {
    const numericValue = roundEstimateValue(parseFloat(value) || 0);
    setInsulationAreas((previous) =>
      previous.map((area) => (area.id === areaId ? { ...area, sqft: numericValue } : area))
    );
  };

  const updateUnit = (areaId: string, value: EstimateUnit) => {
    setInsulationAreas((previous) =>
      previous.map((area) => (area.id === areaId ? { ...area, unit: value } : area))
    );
  };

  const updatePricePerSqft = (areaId: string, value: string) => {
    const numericValue = roundEstimateValue(parseFloat(value) || 0);
    setInsulationAreas((previous) =>
      previous.map((area) =>
        area.id === areaId ? { ...area, pricePerSqft: numericValue } : area
      )
    );
  };

  const addCustomLineItem = () => {
    const newItem: InsulationArea = {
      id: `custom_${Date.now()}`,
      name: '',
      productId: null,
      productType: null,
      description: 'Custom line item',
      enabled: true,
      rValue: null,
      sqft: 0,
      unit: 'SF',
      pricePerSqft: 0,
      isCustom: true,
      group: 'Custom',
    };
    setInsulationAreas((previous) => [...previous, newItem]);
  };

  const addServiceLineItem = () => {
    const newItem: InsulationArea = {
      id: `service_${Date.now()}`,
      name: '',
      productId: null,
      productType: null,
      description: 'Service line item',
      enabled: true,
      rValue: null,
      sqft: 1,
      unit: 'EA',
      pricePerSqft: 0,
      isCustom: true,
      group: 'Services',
    };

    setInsulationAreas((previous) => [...previous, newItem]);
  };

  const removeCustomLineItem = (areaId: string) => {
    setInsulationAreas((previous) => previous.filter((area) => area.id !== areaId));
  };

  const getEnabledAreas = () => insulationAreas.filter((area) => area.enabled);

  const buildLineItems = () =>
    getEnabledAreas().map((area) => ({
      id: area.id,
      area: area.productType || area.name,
      productId: area.productId ?? null,
      productType: area.productType ?? null,
      quantity: area.sqft,
      unit: area.unit,
      sqft: area.sqft,
      rValue: area.rValue ?? parseRValueNumber(area.spec),
      pricePerUnit: area.pricePerSqft,
      pricePerSqft: area.pricePerSqft,
      totalCost: roundEstimateValue(area.sqft * area.pricePerSqft),
      isCustom: area.isCustom || false,
      section: getSectionForArea(area).title,
      notes: formatLineDescriptor(area),
      spec: area.spec ?? null,
    }));

  const getValidationErrors = () => {
    const errors: string[] = [];
    const enabledAreas = getEnabledAreas();

    if (enabledAreas.length === 0) {
      errors.push('Include at least one estimate row before generating the quote.');
    }

    for (const area of enabledAreas) {
      if (!area.productType?.trim() && !area.name.trim()) {
        errors.push('Every included row needs a product/service or line item description.');
      }
      if (area.sqft <= 0) {
        errors.push(`${area.name || 'Unnamed row'} must have a quantity greater than 0.`);
      }
      if (area.pricePerSqft < 0) {
        errors.push(`${area.name || 'Unnamed row'} has an invalid unit rate.`);
      }
    }

    return errors;
  };

  const calculateTotals = () => {
    const totals = calculateQuoteTotals(buildLineItems(), taxAmount);
    return {
      subtotal: totals.subtotal,
      totalSqft: totals.totalSf,
      totalLf: totals.totalLf,
      totalEa: totals.totalEa,
      quantityLabel: totals.quantityLabel,
      total: totals.totalCost,
    };
  };

  const handleGenerateQuote = async () => {
    if (!project) {
      setError('Project not found');
      return;
    }

    const errors = getValidationErrors();
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const lineItems = buildLineItems();

      const { subtotal, total } = calculateTotals();
      const idempotencyKey = crypto.randomUUID();

      const response = await fetch('/api/quote/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          projectId: project.id,
          idempotencyKey,
          lineItems,
          subtotal,
          taxAmount,
          totalCost: total,
          terms,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate quote');
      }

      setQuote(data.quote);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Failed to generate quote');
    } finally {
      setIsGenerating(false);
    }
  };

  const sectionGroups = useMemo(() => {
    return ESTIMATE_SECTIONS.map((section) => ({
      ...section,
      items: insulationAreas.filter((area) => getSectionForArea(area).key === section.key),
    })).filter((section) =>
      section.items.length > 0 ||
      section.key === 'services' ||
      section.key === 'custom'
    );
  }, [insulationAreas]);

  if (isLoading) {
    return (
      <div className="takeoff-shell takeoff-light-theme flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--takeoff-text-muted)]" />
      </div>
    );
  }

  const validationErrors = getValidationErrors();
  const { subtotal, quantityLabel, total } = calculateTotals();
  const enabledAreas = getEnabledAreas();
  let rowNumber = 1;

  return (
    <div className="takeoff-shell takeoff-light-theme min-h-screen px-6 py-8 text-[var(--takeoff-ink)]">
      <div className="takeoff-dot-grid fixed inset-0 pointer-events-none" />
      <div className="mx-auto max-w-[1380px]">
        <div className="relative mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="ev-label">
              Estimate Template
            </p>
            <h1 className="ev-title mt-3 text-[36px]">
              {project?.name || 'Estimate Quote'}
            </h1>
            <p className="ev-muted mt-2 text-sm">
              Clean estimate worksheet seeded from takeoff.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href={reviewHref}>
              <Button variant="outline" className="ev-secondary-action px-5">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Review
              </Button>
            </Link>
            <Button
              onClick={handleGenerateQuote}
              disabled={isGenerating || validationErrors.length > 0}
              className="ev-primary-action px-5"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  {quote ? 'Regenerate Quote' : 'Generate Quote'}
                </>
              )}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="relative mb-4 flex items-start gap-3 rounded-[18px] border border-[#e0b1b5] bg-[#fff5f5] px-4 py-3 text-sm text-[var(--takeoff-accent)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {validationErrors.length > 0 ? (
          <div className="relative mb-4 rounded-[18px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3 text-sm text-[var(--takeoff-text-muted)]">
            <p className="font-medium text-[var(--takeoff-ink)]">Finish these before generating:</p>
            <ul className="mt-2 space-y-1">
              {validationErrors.slice(0, 3).map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="relative rounded-[24px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] shadow-[0_20px_50px_rgba(31,39,33,0.08)] backdrop-blur-xl">
          <div className="border-b border-[var(--takeoff-line)] px-8 py-6">
            <div className="grid grid-cols-[minmax(0,1fr),130px,130px,150px] gap-4 text-sm">
              <div>
                <p className="ev-label">
                  Estimate worksheet
                </p>
                <p className="ev-muted mt-2">
                  Adjust descriptions, quantity, and unit pricing before quote generation.
                </p>
              </div>
              <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3">
                <p className="ev-label">
                  Rows
                </p>
                <p className="mt-1 text-xl font-semibold">{enabledAreas.length}</p>
              </div>
              <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3">
                <p className="ev-label">
                  Quantity
                </p>
                <p className="mt-1 text-xl font-semibold">{quantityLabel}</p>
              </div>
              <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3">
                <p className="ev-label">
                  Subtotal
                </p>
                <p className="mt-1 text-xl font-semibold">{formatCurrency(subtotal)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 px-8 py-8">
            {sectionGroups.map((section) => {
              const sectionSubtotal = roundEstimateValue(
                section.items
                  .filter((item) => item.enabled)
                  .reduce((sum, item) => sum + item.sqft * item.pricePerSqft, 0)
              );

              return (
                <section key={section.key} className="overflow-hidden rounded-[20px] border border-[var(--takeoff-line)]">
                  <div className="flex items-center justify-between border-b border-[rgba(20,24,20,0.16)] bg-[var(--takeoff-ink)] px-5 py-2 text-white">
                    <p className="takeoff-mono text-[11px] uppercase tracking-[0.24em]">
                      {section.code} - {section.title}
                    </p>
                    <p className="text-sm font-semibold">{formatCurrency(sectionSubtotal)}</p>
                  </div>

                  <div className="grid grid-cols-[56px,minmax(190px,0.85fr),minmax(220px,1fr),96px,76px,118px,130px,70px,40px] gap-0 border-b border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] text-[11px] uppercase tracking-[0.18em] text-[var(--takeoff-text-subtle)]">
                    <span className="px-4 py-3">Item</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3">Product / Service</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3">Scope / Spec</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3 text-right">Qty</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3">Unit</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3 text-right">Unit price</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3 text-right">Amount</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3 text-right">Use</span>
                    <span className="border-l border-[var(--takeoff-line)] px-4 py-3" />
                  </div>

                  <div className="bg-white">
                    {section.items.length === 0 ? (
                      <div className="flex items-center justify-between px-5 py-5 text-sm text-[var(--takeoff-text-muted)]">
                        <span>No rows in this section yet.</span>
                        {section.key === 'services' ? (
                          <Button
                            variant="outline"
                            onClick={addServiceLineItem}
                            className="ev-secondary-action"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Service
                          </Button>
                        ) : section.key === 'custom' ? (
                          <Button
                            variant="outline"
                            onClick={addCustomLineItem}
                            className="ev-secondary-action"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Row
                          </Button>
                        ) : null}
                      </div>
                      ) : (
                        section.items.map((area) => {
                          const descriptor = formatLineDescriptor(area);
                          const amount = roundEstimateValue(area.sqft * area.pricePerSqft);
                          const currentRowNumber = rowNumber++;
                          const productOptions = productCatalog.filter((product) =>
                            productMatchesGroup(product, area.group)
                          );

                          return (
                            <Fragment key={area.id}>
                              <div
                                className={`grid grid-cols-[56px,minmax(190px,0.85fr),minmax(220px,1fr),96px,76px,118px,130px,70px,40px] gap-0 border-b border-[var(--takeoff-line)] ${
                                  area.enabled ? 'bg-white' : 'bg-[var(--takeoff-paper)] text-[var(--takeoff-text-subtle)]'
                                }`}
                              >
                                <div className="px-4 py-4 text-sm font-medium text-[var(--takeoff-text-muted)]">
                                  {currentRowNumber}
                                </div>

                                <div className="border-l border-[var(--takeoff-line)] px-3 py-3">
                                  <select
                                    value={area.productId ?? ''}
                                    onChange={(event) => updateProduct(area.id, event.target.value)}
                                    className="h-10 w-full rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 text-sm font-medium text-[var(--takeoff-ink)] outline-none"
                                  >
                                    <option value="">Select product</option>
                                    {productOptions.map((product) => (
                                      <option key={product.id} value={product.id}>
                                        {product.name}{product.spec ? ` - ${product.spec}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => startAddingProduct(area)}
                                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--takeoff-ink)] hover:text-[var(--takeoff-accent)]"
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add product
                                  </button>
                                </div>

                                <div className="border-l border-[var(--takeoff-line)] px-4 py-3">
                                  <Input
                                    value={area.name}
                                    onChange={(event) => updateName(area.id, event.target.value)}
                                    placeholder="Scope or service note"
                                    className="h-10 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                                  />
                                  {descriptor ? (
                                    <p className="mt-1 text-xs leading-5 text-[var(--takeoff-text-muted)]">{descriptor}</p>
                                  ) : null}
                                </div>

                                <div className="border-l border-[var(--takeoff-line)] px-3 py-3">
                                  <Input
                                    value={formatEditableNumber(area.sqft)}
                                    onChange={(event) => updateSqft(area.id, event.target.value)}
                                    inputMode="decimal"
                                    className="h-10 border-0 bg-transparent px-0 text-right text-sm shadow-none focus-visible:ring-0"
                                  />
                                </div>

                                <div className="border-l border-[var(--takeoff-line)] px-3 py-3">
                                  <select
                                    value={area.unit}
                                    onChange={(event) => updateUnit(area.id, event.target.value as EstimateUnit)}
                                    className="h-10 w-full border-0 bg-transparent px-0 text-sm text-[var(--takeoff-ink)] outline-none"
                                  >
                                    {ESTIMATE_UNIT_OPTIONS.map((unit) => (
                                      <option key={unit} value={unit}>{unit}</option>
                                    ))}
                                  </select>
                                </div>

                                <div className="border-l border-[var(--takeoff-line)] px-3 py-3">
                                  <Input
                                    value={formatEditableNumber(area.pricePerSqft)}
                                    onChange={(event) => updatePricePerSqft(area.id, event.target.value)}
                                    inputMode="decimal"
                                    className="h-10 border-0 bg-transparent px-0 text-right text-sm shadow-none focus-visible:ring-0"
                                  />
                                </div>

                                <div className="flex items-center justify-end border-l border-[var(--takeoff-line)] px-4 py-3 text-sm font-semibold">
                                  {formatCurrency(amount)}
                                </div>

                                <div className="flex items-center justify-end border-l border-[var(--takeoff-line)] px-4 py-3">
                                  <label className="flex items-center justify-end">
                                    <input
                                      type="checkbox"
                                      checked={area.enabled}
                                      onChange={() => toggleArea(area.id)}
                                      className="h-4 w-4 rounded border-[var(--takeoff-line)] text-[var(--takeoff-ink)] focus:ring-[var(--takeoff-ink)]"
                                    />
                                  </label>
                                </div>

                                <div className="flex items-center justify-center border-l border-[var(--takeoff-line)] px-1 py-3">
                                  {area.isCustom ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeCustomLineItem(area.id)}
                                      className="h-8 w-8 text-[var(--takeoff-text-muted)] hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>

                              {addingProductForAreaId === area.id ? (
                                <div className="grid grid-cols-[56px,minmax(190px,0.85fr),minmax(220px,1fr),96px,76px,118px,130px,70px,40px] gap-0 border-b border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                                  <div />
                                  <div className="col-span-8 border-l border-[var(--takeoff-line)] px-4 py-4">
                                    <div className="grid gap-3 lg:grid-cols-[minmax(190px,1.2fr),minmax(170px,1fr),120px,90px,120px,auto]">
                                      <Input
                                        value={productDraft.name}
                                        onChange={(event) => setProductDraft((draft) => ({ ...draft, name: event.target.value }))}
                                        placeholder="Product or service name"
                                        className="h-10 rounded-[12px] bg-white text-sm"
                                      />
                                      <Input
                                        value={productDraft.spec}
                                        onChange={(event) => setProductDraft((draft) => ({ ...draft, spec: event.target.value }))}
                                        placeholder="Spec, assembly, or note"
                                        className="h-10 rounded-[12px] bg-white text-sm"
                                      />
                                      <select
                                        value={productDraft.group}
                                        onChange={(event) => setProductDraft((draft) => ({ ...draft, group: event.target.value as EstimateGroup }))}
                                        className="h-10 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 text-sm text-[var(--takeoff-ink)] outline-none"
                                      >
                                        {ESTIMATE_GROUP_OPTIONS.map((group) => (
                                          <option key={group} value={group}>{group}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={productDraft.unit}
                                        onChange={(event) => setProductDraft((draft) => ({ ...draft, unit: event.target.value as EstimateUnit }))}
                                        className="h-10 rounded-[12px] border border-[var(--takeoff-line)] bg-white px-3 text-sm text-[var(--takeoff-ink)] outline-none"
                                      >
                                        {ESTIMATE_UNIT_OPTIONS.map((unit) => (
                                          <option key={unit} value={unit}>{unit}</option>
                                        ))}
                                      </select>
                                      <Input
                                        value={productDraft.defaultPrice}
                                        onChange={(event) => setProductDraft((draft) => ({ ...draft, defaultPrice: event.target.value }))}
                                        inputMode="decimal"
                                        placeholder="Default price"
                                        className="h-10 rounded-[12px] bg-white text-sm"
                                      />
                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="button"
                                          onClick={() => saveProduct(area.id)}
                                          disabled={isSavingProduct}
                                          className="h-10 px-4"
                                        >
                                          {isSavingProduct ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          onClick={cancelAddingProduct}
                                          className="h-10 px-3"
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                    {productError ? (
                                      <p className="mt-2 text-xs text-[var(--takeoff-accent)]">{productError}</p>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </Fragment>
                          );
                        })
                      )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-5 py-3 text-sm">
                    <div className="flex items-center gap-4">
                      {section.key === 'services' ? (
                        <Button
                          variant="ghost"
                          onClick={addServiceLineItem}
                          className="h-auto px-0 text-[var(--takeoff-ink)] hover:bg-transparent hover:text-[var(--takeoff-accent)]"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Service
                        </Button>
                      ) : section.key === 'custom' ? (
                        <Button
                          variant="ghost"
                          onClick={addCustomLineItem}
                          className="h-auto px-0 text-[var(--takeoff-ink)] hover:bg-transparent hover:text-[var(--takeoff-accent)]"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Row
                        </Button>
                      ) : (
                        <span className="ev-label">
                          Section subtotal
                        </span>
                      )}
                    </div>
                    <span className="font-semibold">{formatCurrency(sectionSubtotal)}</span>
                  </div>
                </section>
              );
            })}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="rounded-[20px] border border-[var(--takeoff-line)] bg-white p-6">
                <div className="flex items-center justify-between border-b border-[var(--takeoff-line)] pb-3">
                  <p className="ev-label">
                    Terms & Conditions
                  </p>
                </div>
                <textarea
                  value={terms}
                  onChange={(event) => setTerms(event.target.value)}
                  className="mt-4 min-h-[140px] w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-7 text-[var(--takeoff-text-muted)] outline-none"
                  placeholder="Add estimate notes, exclusions, or payment terms."
                />
              </section>

              <section className="rounded-[20px] border border-[var(--takeoff-line)] bg-white p-6">
                <div className="space-y-3">
                  <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="ev-label">
                        Subtotal
                      </span>
                      <span className="font-semibold">{formatCurrency(subtotal)}</span>
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="ev-label">
                        Tax
                      </span>
                      <Input
                        value={formatEditableNumber(taxAmount)}
                        onChange={(event) =>
                          setTaxAmount(roundEstimateValue(parseFloat(event.target.value) || 0))
                        }
                        inputMode="decimal"
                        className="h-10 border-0 bg-transparent px-0 text-right text-sm shadow-none focus-visible:ring-0"
                      />
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-[rgba(20,24,20,0.16)] bg-[#edf5e8] px-4 py-4">
                    <div className="flex items-center justify-between">
                      <span className="takeoff-mono text-[12px] uppercase tracking-[0.22em] text-[#47644a]">
                        Total
                      </span>
                      <span className="text-xl font-semibold">{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>

                {quote?.pdf_url ? (
                  <div className="mt-6 space-y-3">
                    <Button
                      variant="outline"
                      className="ev-secondary-action w-full"
                      onClick={() => {
                        const downloadUrl =
                          quote.download_url ||
                          (quote.pdf_url?.startsWith('http')
                            ? quote.pdf_url
                            : `${window.location.origin}${quote.pdf_url}`);
                        const subject = encodeURIComponent(
                          `Insulation Quote - ${project?.name || 'Project'}`
                        );
                        const body = encodeURIComponent(
                          `Please find the insulation quote attached.\n\nDownload: ${downloadUrl}`
                        );
                        window.open(`mailto:?subject=${subject}&body=${body}`);
                      }}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Email Quote
                    </Button>
                    <a href={quote.download_url || quote.pdf_url} target="_blank" rel="noopener noreferrer" className="block">
                      <Button className="ev-primary-action w-full">
                        <Download className="mr-2 h-4 w-4" />
                        Download PDF
                      </Button>
                    </a>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
