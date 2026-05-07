import assert from 'node:assert/strict';
import { normalizeQuoteLineItems } from '../lib/quotes/estimate';
import {
  DEFAULT_QUOTE_PRODUCTS,
  mergeQuoteProduct,
  normalizeQuoteProducts,
  type QuoteProduct,
} from '../lib/quotes/products';

const exteriorWallOptions = DEFAULT_QUOTE_PRODUCTS.filter(
  (product) => product.name === 'Exterior Walls',
);
const kneewallOptions = DEFAULT_QUOTE_PRODUCTS.filter(
  (product) => product.name === 'Kneewalls',
);
const serviceOptions = DEFAULT_QUOTE_PRODUCTS.filter(
  (product) => product.group === 'Services',
);

assert.equal(exteriorWallOptions.length, 1);
assert.equal(exteriorWallOptions[0].spec, 'R-21x15+Poly');
assert.equal(kneewallOptions.length, 2);
assert.deepEqual(
  kneewallOptions.map((product) => product.spec).sort(),
  ['R-21x16+Poly', 'R-21x23+Poly'],
);

const customProduct: QuoteProduct = {
  id: 'kneewalls-custom',
  name: 'Kneewalls',
  group: 'Walls',
  unit: 'SF',
  defaultPrice: 2.75,
  spec: 'R-30 Custom',
};
const merged = mergeQuoteProduct(DEFAULT_QUOTE_PRODUCTS, customProduct);
assert.equal(
  merged.filter((product) => product.name === 'Kneewalls').length,
  3,
);
assert.ok(serviceOptions.some((product) => product.name === 'Blower Door Test' && product.unit === 'EA'));
assert.ok(serviceOptions.some((product) => product.name === 'Duct Leakage Test' && product.unit === 'EA'));
assert.ok(serviceOptions.some((product) => product.name === 'Blower Door & Duct Tests' && product.unit === 'EA'));

const normalizedProducts = normalizeQuoteProducts([
  { id: 'blower-door', name: 'Blower Door Test', group: 'Services', unit: 'EA', defaultPrice: 250 },
]);
assert.equal(normalizedProducts[0].name, 'Blower Door Test');
assert.equal(normalizedProducts[0].group, 'Services');
assert.equal(normalizedProducts[0].defaultPrice, 250);

const normalizedLineItems = normalizeQuoteLineItems([
  {
    id: 'line-1',
    area: 'Attic Blow',
    productId: 'attic-blow-r49',
    productType: 'Attic Blow',
    quantity: 3706,
    unit: 'SF',
    pricePerUnit: 1.35,
    section: 'Ceilings & Attics',
    spec: 'R49 Blow',
  },
]);
assert.equal(normalizedLineItems[0].productId, 'attic-blow-r49');
assert.equal(normalizedLineItems[0].productType, 'Attic Blow');
assert.equal(normalizedLineItems[0].spec, 'R49 Blow');

console.log('quote-products eval passed');
