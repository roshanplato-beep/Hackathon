// Reproducible public OSM extract; no credentials. Geometry only, no personal data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const zones = JSON.parse(await readFile(new URL('../../backend/data/chennai_zones.json', import.meta.url)));
const bbox = '12.88,80.08,13.14,80.30';
const buildings = zones.map(z => `way[building](around:700,${z.center.join(',')});`).join('\n');
const query = `[out:json][timeout:180];(way[highway~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});way[natural=coastline](${bbox});way[waterway~"^(river|canal)$"](${bbox});way[natural=water](${bbox});way[leisure=park](${bbox});way[landuse=forest](${bbox});${buildings});out tags geom;`;
let body;
for (const host of ['https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
  try {
    const res = await fetch(`${host}?${new URLSearchParams({ data:query })}`, { signal:AbortSignal.timeout(210000) });
    if (!res.ok) throw new Error(`OSM HTTP ${res.status}`);
    body = await res.json();
    if (body.remark) throw new Error(body.remark);
    break;
  } catch(e) { console.log(e.message); }
}
if (!body?.elements?.length) throw new Error('No OSM geometry retrieved');
const features = body.elements.filter(e => e.geometry?.length > 1).map(e => {
  const t=e.tags||{};
  const kind=t.building?'building':t.natural==='coastline'?'coast':t.highway?'road':t.waterway||t.natural==='water'?'water':'green';
  return { id:e.id, kind, name:t.name||'', height:parseFloat(t.height)||parseFloat(t['building:levels'])*3||null, points:e.geometry.map(p=>[+p.lon.toFixed(6),+p.lat.toFixed(6)]) };
});
const asset={source:'OpenStreetMap contributors',license:'ODbL 1.0',url:'https://www.openstreetmap.org/copyright',fetchedAt:new Date().toISOString(),bbox:[12.88,80.08,13.14,80.30],note:'Building footprints sampled within 700m of each zone centre. Heights without OSM tags use illustrative 9m extrusion; height exaggerated 4x for tabletop readability. Zone bounds come from the project, not administrative boundaries.',features};
await mkdir(new URL('../public/vr/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/vr/chennai-osm.json',import.meta.url),JSON.stringify(asset));
console.log(JSON.stringify({features:features.length,buildings:features.filter(f=>f.kind==='building').length}));
