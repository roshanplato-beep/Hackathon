import test from 'node:test';
import assert from 'node:assert/strict';
import { displayZone, currentWeather, hasMappedData } from './dataStatus.js';

test('fallback metrics are hidden, not converted to zero or cold colours', () => {
  const zone = displayZone({ osm_fetched: false, lst_celsius: 35, heat_risk_score: 60, estimated_population: 1000 });
  assert.equal(zone.lst_celsius, null);
  assert.equal(zone.heat_risk_score, null);
  assert.equal(zone.estimated_population, null);
  assert.equal(zone.risk_level, 'Unavailable');
});
test('missing, old, and future timestamps cannot qualify as recent mapping', () => {
  const now = Date.parse('2026-09-08T06:00:00Z');
  assert.equal(hasMappedData({ osm_fetched: true }, now), false);
  assert.equal(hasMappedData({ osm_fetched: true, osm_fetched_at: '2026-09-06T06:00:00Z' }, now), false);
  assert.equal(hasMappedData({ osm_fetched: true, osm_fetched_at: '2026-09-09T06:00:00Z' }, now), false);
  assert.equal(hasMappedData({ osm_fetched: true, osm_fetched_at: '2026-09-08T05:00:00Z' }, now), true);
});
test('stale weather is withheld even if numeric and recently timestamped', () => {
  const now = Date.parse('2026-09-08T06:00:00Z');
  const reading = { air_temp_c: 30, observed_at: '2026-09-08T05:45', status: 'current' };
  assert.equal(currentWeather(reading, now), true);
  assert.equal(currentWeather({ ...reading, status: 'stale' }, now), false);
  assert.equal(currentWeather({ ...reading, observed_at: null }, now), false);
});
