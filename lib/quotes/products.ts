import {
  roundEstimateValue,
  type EstimateGroup,
  type EstimateUnit,
} from './estimate';

export interface QuoteProduct {
  id: string;
  name: string;
  group: EstimateGroup;
  unit: EstimateUnit;
  defaultPrice: number;
  spec?: string | null;
}

const ESTIMATE_GROUPS: EstimateGroup[] = ['Walls', 'Floors', 'Ceilings', 'Specialty', 'Services', 'Custom'];
const ESTIMATE_UNITS: EstimateUnit[] = ['SF', 'LF', 'EA'];

export const QUOTE_PRODUCTS_SETTINGS_KEY = 'quote_products';

export const DEFAULT_QUOTE_PRODUCTS: QuoteProduct[] = [
  {
    id: 'attic-blow-r49',
    name: 'Attic Blow',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R49 Blow',
  },
  {
    id: 'baffles-12-above-blow',
    name: 'Baffles',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
    spec: '12" Above Blow',
  },
  {
    id: 'bonus-flat-ceiling-r49x23-poly',
    name: 'Bonus Flat Ceiling',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R49x23+Poly',
  },
  {
    id: 'bonus-exterior-walls-r21x15-poly',
    name: 'Bonus Exterior Walls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R-21x15+Poly',
  },
  {
    id: 'bonus-kneewalls-r21x23-poly',
    name: 'Bonus Kneewalls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R-21x23+Poly',
  },
  {
    id: 'bonus-floor-r38x16-support-waterpipe',
    name: 'Bonus Floor',
    group: 'Floors',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R38x16+Support+Waterpipe',
  },
  {
    id: 'vaulted-ceiling-r49x23-poly',
    name: 'Vaulted Ceiling',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R49x23+Poly',
  },
  {
    id: 'exterior-walls-r21x15-poly',
    name: 'Exterior Walls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R-21x15+Poly',
  },
  {
    id: 'kneewalls-r21x16-poly',
    name: 'Kneewalls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R-21x16+Poly',
  },
  {
    id: 'kneewalls-r21x23-poly',
    name: 'Kneewalls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R-21x23+Poly',
  },
  {
    id: 'rimjoist-r21x15ff-fs-poly',
    name: 'Rimjoist',
    group: 'Specialty',
    unit: 'LF',
    defaultPrice: 0,
    spec: 'R-21x15ff+FS Poly',
  },
  {
    id: 'headers-foam-board',
    name: 'Headers',
    group: 'Specialty',
    unit: 'LF',
    defaultPrice: 0,
    spec: '1.5" Foam Board',
  },
  {
    id: 'wrap-ducts-r10-fsk',
    name: 'Wrap Ducts',
    group: 'Services',
    unit: 'LF',
    defaultPrice: 0,
    spec: 'R-10 FSK',
  },
  {
    id: 'garage-ceiling-r49-blown-fiberglass',
    name: 'Garage Ceiling',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R49 Blown Fiberglass',
  },
  {
    id: 'garage-walls-r19x15-poly',
    name: 'Garage Walls',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 0,
    spec: 'R19x15+Poly',
  },
  {
    id: 'blower-door-duct-tests',
    name: 'Blower Door & Duct Tests',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
  },
  {
    id: 'blower-door-test',
    name: 'Blower Door Test',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
  },
  {
    id: 'duct-leakage-test',
    name: 'Duct Leakage Test',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
  },
  {
    id: 'foam-caulk-penetration',
    name: 'Foam & Caulk Penetration',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
    spec: '& trimmed windows',
  },
  {
    id: 'air-sealing-labor',
    name: 'Air Sealing Labor',
    group: 'Services',
    unit: 'EA',
    defaultPrice: 0,
  },
  {
    id: 'fiberglass-batt',
    name: 'Fiberglass batt',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 1.5,
  },
  {
    id: 'blown-in-fiberglass',
    name: 'Blown-in fiberglass',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 1.25,
  },
  {
    id: 'blown-in-cellulose',
    name: 'Blown-in cellulose',
    group: 'Ceilings',
    unit: 'SF',
    defaultPrice: 1.35,
  },
  {
    id: 'open-cell-spray-foam',
    name: 'Open-cell spray foam',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 2.8,
  },
  {
    id: 'closed-cell-spray-foam',
    name: 'Closed-cell spray foam',
    group: 'Specialty',
    unit: 'SF',
    defaultPrice: 4.25,
  },
  {
    id: 'mineral-wool-batt',
    name: 'Mineral wool batt',
    group: 'Walls',
    unit: 'SF',
    defaultPrice: 2.15,
  },
  {
    id: 'rim-joist-spray-foam',
    name: 'Rim joist spray foam',
    group: 'Specialty',
    unit: 'LF',
    defaultPrice: 8,
  },
];

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

export function normalizeQuoteProducts(value: unknown): QuoteProduct[] {
  if (!Array.isArray(value)) return DEFAULT_QUOTE_PRODUCTS;

  const products = value
    .map((item, index): QuoteProduct | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const name = readString(record.name);
      if (!name) return null;

      return {
        id: readString(record.id) || `product:${index}`,
        name,
        group: normalizeGroup(record.group),
        unit: normalizeUnit(record.unit),
        defaultPrice: roundEstimateValue(Math.max(0, readNumber(record.defaultPrice))),
        spec: readString(record.spec) || null,
      };
    })
    .filter((product): product is QuoteProduct => Boolean(product));

  return products.length > 0 ? products : DEFAULT_QUOTE_PRODUCTS;
}

export function normalizeQuoteProductInput(value: unknown): QuoteProduct | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const name = readString(record.name);
  if (!name) return null;

  return {
    id: readString(record.id) || crypto.randomUUID(),
    name,
    group: normalizeGroup(record.group),
    unit: normalizeUnit(record.unit),
    defaultPrice: roundEstimateValue(Math.max(0, readNumber(record.defaultPrice))),
    spec: readString(record.spec) || null,
  };
}

export function mergeQuoteProduct(
  products: QuoteProduct[],
  product: QuoteProduct,
) {
  const productName = product.name.toLowerCase();
  const productSpec = (product.spec ?? '').toLowerCase();
  let matched = false;
  const merged = products.map((existing) => {
    const sameCatalogEntry =
      existing.id === product.id ||
      (
        existing.name.toLowerCase() === productName &&
        (existing.spec ?? '').toLowerCase() === productSpec &&
        existing.unit === product.unit
      );

    if (!sameCatalogEntry) {
      return existing;
    }

    matched = true;
    return { ...product, id: existing.id };
  });

  return matched ? merged : [...products, product];
}
