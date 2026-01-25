import { LineItem } from './insulation';

/**
 * Format currency value
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format square footage
 */
export function formatSqft(sqft: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(sqft);
}

/**
 * Calculate subtotal from line items
 */
export function calculateSubtotal(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.totalCost, 0);
}

/**
 * Calculate tax
 */
export function calculateTax(subtotal: number, taxRate: number = 0): number {
  return subtotal * taxRate;
}

/**
 * Calculate total with tax
 */
export function calculateTotal(subtotal: number, taxRate: number = 0): number {
  return subtotal + calculateTax(subtotal, taxRate);
}

/**
 * Apply discount to total
 */
export function applyDiscount(
  total: number,
  discountPercent: number
): {
  discountAmount: number;
  finalTotal: number;
} {
  const discountAmount = total * (discountPercent / 100);
  return {
    discountAmount,
    finalTotal: total - discountAmount,
  };
}

/**
 * Calculate average price per sqft across all line items
 */
export function calculateAveragePricePerSqft(lineItems: LineItem[]): number {
  const totalSqft = lineItems.reduce((sum, item) => sum + item.sqft, 0);
  const totalCost = lineItems.reduce((sum, item) => sum + item.totalCost, 0);

  if (totalSqft === 0) return 0;

  return totalCost / totalSqft;
}

/**
 * Get breakdown by R-value
 */
export function getRValueBreakdown(lineItems: LineItem[]): Array<{
  rValue: number | null;
  sqft: number;
  cost: number;
  percentage: number;
}> {
  const totalSqft = lineItems.reduce((sum, item) => sum + item.sqft, 0);
  const grouped = new Map<number | null, { sqft: number; cost: number }>();

  for (const item of lineItems) {
    const existing = grouped.get(item.rValue) || { sqft: 0, cost: 0 };
    grouped.set(item.rValue, {
      sqft: existing.sqft + item.sqft,
      cost: existing.cost + item.totalCost,
    });
  }

  return Array.from(grouped.entries()).map(([rValue, data]) => ({
    rValue,
    sqft: data.sqft,
    cost: data.cost,
    percentage: totalSqft > 0 ? (data.sqft / totalSqft) * 100 : 0,
  }));
}
