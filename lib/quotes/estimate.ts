export type EstimateGroup = 'Walls' | 'Floors' | 'Ceilings' | 'Specialty' | 'Custom';
export type EstimateUnit = 'SF' | 'LF' | 'EA';
export type EstimateSource = 'takeoff' | 'manual';

export interface EstimateWorksheetRow {
  id: string;
  group: EstimateGroup;
  label: string;
  quantity: number;
  unit: EstimateUnit;
  spec: string;
  note: string;
  source: EstimateSource;
  enabled: boolean;
}

export interface QuoteLineItem {
  id: string;
  area: string;
  quantity: number;
  unit: EstimateUnit;
  sqft: number;
  rValue: number | null;
  pricePerUnit: number;
  pricePerSqft: number;
  totalCost: number;
  isCustom?: boolean;
  section?: string | null;
  notes?: string | null;
  spec?: string | null;
}

export interface QuoteTotals {
  subtotal: number;
  taxAmount: number;
  totalCost: number;
  totalSf: number;
  totalLf: number;
  totalEa: number;
  quantityLabel: string;
}

const ESTIMATE_GROUPS: EstimateGroup[] = ['Walls', 'Floors', 'Ceilings', 'Specialty', 'Custom'];
const ESTIMATE_UNITS: EstimateUnit[] = ['SF', 'LF', 'EA'];

export const ESTIMATE_GROUP_SECTION_TITLE: Record<EstimateGroup, string> = {
  Walls: 'Wall Assemblies',
  Floors: 'Floors & Crawlspaces',
  Ceilings: 'Ceilings & Attics',
  Specialty: 'Specialty Scope',
  Custom: 'Manual Additions',
};

export function roundEstimateValue(value: number, precision = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(precision));
}

export function normalizeQuantity(value: number): number {
  return Math.round(value * 10) / 10;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeGroup(value: unknown): EstimateGroup {
  return ESTIMATE_GROUPS.includes(value as EstimateGroup)
    ? (value as EstimateGroup)
    : 'Custom';
}

function normalizeUnit(value: unknown): EstimateUnit {
  return ESTIMATE_UNITS.includes(value as EstimateUnit)
    ? (value as EstimateUnit)
    : 'SF';
}

function normalizeSource(value: unknown): EstimateSource {
  return value === 'manual' ? 'manual' : 'takeoff';
}

export function sanitizeEstimateRows(value: unknown): EstimateWorksheetRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): EstimateWorksheetRow | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = readString(record.id) || `manual:legacy:${index}`;
      const label = readString(record.label);
      const quantity = normalizeQuantity(readNumber(record.quantity));

      return {
        id,
        group: normalizeGroup(record.group),
        label,
        quantity,
        unit: normalizeUnit(record.unit),
        spec: readString(record.spec),
        note: readString(record.note),
        source: normalizeSource(record.source),
        enabled: record.enabled !== false,
      };
    })
    .filter((row): row is EstimateWorksheetRow => Boolean(row));
}

export function parseRValueNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\bR\s*[-=]?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatQuantity(value: number, unit: EstimateUnit): string {
  const rounded = roundEstimateValue(value, 1);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(rounded);
  return `${formatted} ${unit}`;
}

export function formatQuantityLabel(totals: Pick<QuoteTotals, 'totalSf' | 'totalLf' | 'totalEa'>): string {
  const parts = [
    totals.totalSf > 0 ? formatQuantity(totals.totalSf, 'SF') : null,
    totals.totalLf > 0 ? formatQuantity(totals.totalLf, 'LF') : null,
    totals.totalEa > 0 ? formatQuantity(totals.totalEa, 'EA') : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' / ') : '0 SF';
}

export function buildQuoteLineItemFromEstimateRow(
  row: EstimateWorksheetRow,
  pricePerUnit: number,
): QuoteLineItem {
  const price = roundEstimateValue(pricePerUnit);
  const totalCost = roundEstimateValue(row.quantity * price);
  const notes = [row.spec, row.note].filter(Boolean).join(' - ') || null;

  return {
    id: row.id,
    area: row.label,
    quantity: row.quantity,
    unit: row.unit,
    sqft: row.unit === 'SF' ? row.quantity : row.quantity,
    rValue: parseRValueNumber(row.spec),
    pricePerUnit: price,
    pricePerSqft: price,
    totalCost,
    isCustom: row.source === 'manual',
    section: ESTIMATE_GROUP_SECTION_TITLE[row.group],
    notes,
    spec: row.spec || null,
  };
}

export function normalizeQuoteLineItems(value: unknown): QuoteLineItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): QuoteLineItem | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const area = readString(record.area) || readString(record.name);
      const quantity =
        readNumber(record.quantity) ||
        readNumber(record.sqft);
      const unit = normalizeUnit(record.unit);
      const pricePerUnit =
        readNumber(record.pricePerUnit) ||
        readNumber(record.pricePerSqft);

      if (!area || quantity <= 0 || pricePerUnit < 0) return null;

      const spec = readString(record.spec);
      const notes = readString(record.notes) || null;
      const rValue =
        typeof record.rValue === 'number' && Number.isFinite(record.rValue)
          ? record.rValue
          : parseRValueNumber(spec || notes);

      return {
        id: readString(record.id) || `line:${index}`,
        area,
        quantity: roundEstimateValue(quantity, 1),
        unit,
        sqft: roundEstimateValue(quantity, 1),
        rValue,
        pricePerUnit: roundEstimateValue(pricePerUnit),
        pricePerSqft: roundEstimateValue(pricePerUnit),
        totalCost: roundEstimateValue(quantity * pricePerUnit),
        isCustom: Boolean(record.isCustom),
        section: readString(record.section) || null,
        notes,
        spec: spec || null,
      };
    })
    .filter((item): item is QuoteLineItem => Boolean(item));
}

export function calculateQuoteTotals(
  lineItems: QuoteLineItem[],
  taxAmountInput = 0,
): QuoteTotals {
  const subtotal = roundEstimateValue(
    lineItems.reduce((sum, item) => sum + item.totalCost, 0),
  );
  const taxAmount = roundEstimateValue(Math.max(0, taxAmountInput));
  const totalSf = roundEstimateValue(
    lineItems.filter((item) => item.unit === 'SF').reduce((sum, item) => sum + item.quantity, 0),
    1,
  );
  const totalLf = roundEstimateValue(
    lineItems.filter((item) => item.unit === 'LF').reduce((sum, item) => sum + item.quantity, 0),
    1,
  );
  const totalEa = roundEstimateValue(
    lineItems.filter((item) => item.unit === 'EA').reduce((sum, item) => sum + item.quantity, 0),
    1,
  );

  return {
    subtotal,
    taxAmount,
    totalCost: roundEstimateValue(subtotal + taxAmount),
    totalSf,
    totalLf,
    totalEa,
    quantityLabel: formatQuantityLabel({ totalSf, totalLf, totalEa }),
  };
}
