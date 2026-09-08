export function freshTimestamp(stamp, maxAge, now = Date.now()) {
  if (!stamp) return false;
  const parsed = Date.parse(/[Z+]|-\d\d:\d\d$/.test(stamp.slice(10)) ? stamp : stamp + 'Z');
  return Number.isFinite(parsed) && now - parsed >= -900000 && now - parsed <= maxAge;
}

export function hasMappedData(zone, now = Date.now()) {
  return zone?.osm_fetched === true && freshTimestamp(zone.osm_fetched_at, 86400000, now);
}

export function currentWeather(reading, now = Date.now()) {
  return reading?.status !== 'stale' && Number.isFinite(reading?.air_temp_c)
    && freshTimestamp(reading?.observed_at, 5400000, now);
}

export function displayZone(zone) {
  const mapped = hasMappedData(zone);
  const result = { ...zone };
  if (!mapped) {
    for (const field of ['building_density_pct', 'green_cover_pct', 'road_coverage_pct',
      'water_proximity_m', 'govt_land_pct', 'govt_land_area_sqm', 'building_count',
      'water_body_count', 'lst_celsius', 'ndvi', 'heat_risk_score']) result[field] = null;
    result.heat_color = '#8494a5';
    result.heat_color_rgba = 'rgba(132,148,165,0.15)';
    result.risk_level = 'Unavailable';
  }
  // Building count is not a population survey; institutional land is not public ownership.
  result.estimated_population = null;
  result.estimated_households = null;
  return result;
}
