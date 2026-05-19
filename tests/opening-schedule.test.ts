import assert from 'node:assert/strict';
import {
  buildOpeningCatalogsFromScheduleItems,
  findCatalogItemByTag,
  normalizeOpeningScheduleItems,
  normalizeOpeningTag,
  parseOpeningScheduleSize,
} from '@/lib/takeoff/opening-schedule';

function near(actual: number | null, expected: number, message: string) {
  assert.equal(typeof actual, 'number', message);
  assert.ok(Math.abs((actual ?? 0) - expected) < 0.001, message);
}

assert.equal(normalizeOpeningTag('101B'), '101.B');
assert.equal(normalizeOpeningTag('101.B'), '101.B');
assert.equal(normalizeOpeningTag('101-B'), '101.B');
assert.equal(normalizeOpeningTag('101 B'), '101.B');
assert.equal(normalizeOpeningTag('W 2'), 'W-2');
assert.equal(normalizeOpeningTag('d-3'), 'D-3');

let parsed = parseOpeningScheduleSize('24in x 80in');
near(parsed.widthFt, 2, '24in width parses to 2ft');
near(parsed.heightFt, 80 / 12, '80in height parses to feet');

parsed = parseOpeningScheduleSize('36 x 56');
near(parsed.widthFt, 3, 'no-unit 36 infers inches');
near(parsed.heightFt, 56 / 12, 'no-unit 56 infers inches');
assert.ok(parsed.reviewFlags.includes('unit_inferred_inches'));

parsed = parseOpeningScheduleSize(`2'-0" x 6'-8"`);
near(parsed.widthFt, 2, 'feet/inches width parses');
near(parsed.heightFt, 6 + 8 / 12, 'feet/inches height parses');

parsed = parseOpeningScheduleSize('3/0 x 5/6');
near(parsed.widthFt, 3, 'slash width parses as feet/inches');
near(parsed.heightFt, 5.5, 'slash height parses as feet/inches');

parsed = parseOpeningScheduleSize('36in x 80in x 1-3/4in');
near(parsed.widthFt, 3, 'door width ignores thickness value');
near(parsed.heightFt, 80 / 12, 'door height ignores thickness value');
assert.equal(parsed.reviewFlags.length, 0);

parsed = parseOpeningScheduleSize('3050');
near(parsed.widthFt, 3, 'compact 3050 width parses');
near(parsed.heightFt, 5, 'compact 3050 height parses');
assert.equal(parsed.reviewFlags.length, 0);

const rows = normalizeOpeningScheduleItems(
  [
    {
      openingType: 'window',
      tag: '101.B',
      room: 'FOYER',
      rawSize: '24in x 80in',
      scheduleType: 'FIXED',
      confidence: 0.92,
    },
    {
      openingType: 'door',
      tag: 'D3',
      room: 'HALL',
      rawSize: `3'-0" x 6'-8"`,
      scheduleType: 'SOLID CORE',
      confidence: 0.88,
    },
  ],
  2,
);

assert.equal(rows.length, 2);
assert.equal(rows[0].tagNormalized, '101.B');
near(rows[0].widthFt, 2, 'fixture window width parses');
near(rows[0].heightFt, 80 / 12, 'fixture window height parses');
assert.equal(rows[0].sourcePageIndex, 2);

const catalogs = buildOpeningCatalogsFromScheduleItems(rows);
assert.equal(catalogs.windowCatalog.length, 1);
assert.equal(catalogs.doorCatalog.length, 1);
assert.equal(catalogs.windowCatalog[0].tagNormalized, '101.B');
assert.equal(findCatalogItemByTag(catalogs.windowCatalog, '101B')?.tagNormalized, '101.B');
assert.equal(findCatalogItemByTag(catalogs.doorCatalog, 'd-3')?.tagNormalized, 'D-3');

const preferredRows = normalizeOpeningScheduleItems([
  {
    openingType: 'window',
    tag: '101.A',
    rawSize: '2040',
    scheduleType: 'FIXED',
    confidence: 0.82,
  },
  {
    openingType: 'window',
    tag: '101.A',
    rawSize: '24in x 80in',
    scheduleType: 'FIXED',
    confidence: 0.8,
  },
]);
assert.equal(preferredRows.length, 1);
assert.equal(preferredRows[0].rawSize, '24in x 80in');
near(preferredRows[0].widthFt, 2, 'explicit row width wins over compact misread');
near(preferredRows[0].heightFt, 80 / 12, 'explicit row height wins over compact misread');

const doorWithThickness = normalizeOpeningScheduleItems([
  {
    openingType: 'door',
    tag: '101-1',
    rawSize: '36in x 80in x 1-3/4in',
    reviewFlags: ['missing_dimension_pair'],
    confidence: 0.9,
  },
]);
assert.equal(doorWithThickness.length, 1);
near(doorWithThickness[0].widthFt, 3, 'door row width parses with thickness');
near(doorWithThickness[0].heightFt, 80 / 12, 'door row height parses with thickness');
assert.equal(doorWithThickness[0].reviewFlags.includes('missing_dimension_pair'), false);

console.log('opening-schedule tests passed');
