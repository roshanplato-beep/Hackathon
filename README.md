# HeatScape — Urban Heat Reduction Planner

Chennai urban-heat analysis with a 3D globe landing page, a live NASA thermal
overlay, and a Leaflet zone workspace, styled as a dark developer console.

## What's here

**Globe landing page** — a Cesium/WebGL Earth globe is the entry point. It spins
idly until you touch it, plots all 18 Chennai zones coloured by heat-risk score,
and dives into the workspace when you pick one.

**Live thermal toggle** — overlays NASA EOSDIS GIBS MODIS/Aqua daytime land
surface temperature on the globe. The globe stays fully interactive with the
overlay on.

**Four workspace screens**, ported from the Stitch designs and driven by the
Chennai zone data:

| Tab | What it does |
|---|---|
| Map Workspace | Zone rail (search, risk filters, ranked cards), Leaflet map with the thermal overlay, zone detail panel |
| Site Planner | Allocate intervention coverage against the zone's government land, with a composition chart and saved plans |
| Cost Estimate | Itemised breakdown from real unit rates — material, installation, site work, contingency |
| Mobile Survey | Field survey capture in a phone frame; records persist per zone |

## Running it

Two processes. Backend first.

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env      # then add your keys
uvicorn app.main:app --reload --port 8000
```

The API comes up on <http://localhost:8000>. Check `/health`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### API keys

`backend/.env` is **not** included in this archive. Copy `.env.example` to
`.env` and fill in:

| Variable | Required? | Without it |
|---|---|---|
| `GEMINI_API_KEY` | Optional | Diagnosis and reports fall back to computed text |
| `OPENWEATHERMAP_API_KEY` | Optional | Weather falls back to Chennai summer averages |

The globe and the thermal layer need **no key at all** — every imagery source is
keyless (Esri, NASA GIBS, OpenStreetMap).

## Endpoints added on top of the original API

| Endpoint | Purpose |
|---|---|
| `GET /api/thermal/config?layer=` | Tile template, resolved imagery date, legend, attribution |
| `GET /api/thermal/tile/{z}/{y}/{x}.png` | Same-origin tile proxy (fallback if the CDN is blocked) |
| `POST /api/estimate` | Itemised cost estimate for a zone's selected interventions |
| `GET/POST /api/plan`, `GET /api/plans` | Saved intervention plans per zone |
| `GET/POST /api/surveys` | Field survey records |

The backend resolves which GIBS date is actually published by probing land
tiles, caches it for six hours, and hands the frontend a ready-to-use template —
so the browser never guesses a date and gets blank tiles.

### Which thermal layer to use

Two are offered, and the difference is large:

| Layer | Freshness | Coverage over Chennai |
|---|---|---|
| `composite` (default) | 8-day, up to a week behind | ~28% of a tile |
| `daily` | Yesterday's pass | ~1% of a tile |

A single MODIS day is riddled with swath gaps and cloud masking. Over Chennai in
September a daily tile is roughly 1% covered — correct, but it reads as a broken
layer. The 8-day composite fills those gaps, so it is the default. Switch to
daily from the map's thermal panel when recency matters more than completeness.

## Data provenance — what is measured and what is modelled

This matters more than any feature here, so it is stated plainly and enforced in
the UI: every number carries a **Measured** or **Modelled** badge, and
`GET /api/provenance` returns the same breakdown machine-readably.

### Measured, from verified public APIs

| Field | Source |
|---|---|
| Building density, green cover, road coverage, water proximity, government land | OpenStreetMap via Overpass API |
| City baseline surface temperature | NASA POWER (MERRA-2) `TS` Earth skin temperature climatology |
| Live air temperature, humidity | Open-Meteo `temperature_2m` |
| Thermal map overlay | NASA EOSDIS GIBS, MODIS/Aqua land surface temperature |
| Weather (when a key is set) | OpenWeatherMap |

### Modelled — derived, not observed

| Field | How |
|---|---|
| `lst_celsius` ("surface temp") | Measured NASA POWER baseline, adjusted by measured OSM morphology: `baseline + density×5.5 − green×4.0 − water + road×3.0`. **Not a satellite pixel reading.** |
| `ndvi` | Linear proxy from measured OSM green cover, not a spectral index |
| `heat_risk_score` | Weighted index over the fields above |
| Intervention temperature drops | Published literature values; see each intervention's `source` |

### What was fixed

The baseline was previously hardcoded as `CITY_BASELINE_LST = 33.6` with a
comment citing a "2020 peer-reviewed mean" but no retrievable source. It is now
fetched at startup from NASA POWER — Chennai's measured peak-month Earth skin
temperature, **32.76 °C (May)** — and the model is anchored to that. The old
constant survives only as an offline fallback, and is reported as unverified
whenever it is used.

### What is still not possible without credentials

Measured **per-ward** land surface temperature. NASA POWER is authoritative but
sits on a ~0.5° (~50 km) grid: it returns an identical 28.81 °C annual mean for
Mount Road, T. Nagar, Tambaram and Vandalur alike, so it cannot differentiate
wards. Open-Meteo is ~11 km and reports *air* temperature, which does not
resolve urban canopy effects. Real 1 km per-ward LST requires MODIS or Landsat
pixel values through NASA Earthdata (AppEEARS) or Google Earth Engine, both of
which need an account.

Until then, ward-level contrast is model output, and the UI says so on every
figure.

## Honest limits

- The globe is **Cesium with Esri imagery**, not Google Earth. Google Earth is
  not embeddable as a library; Cesium is the open engine WebGL Earth is built on.
- The thermal layer is a **daily composite, not real time**. Roughly one to
  three days behind. Truly real-time global thermal imagery is not publicly
  available.
- Dark bands across the thermal layer are **gaps between satellite swaths**, not
  missing heat.
- Thermal data is 1 km resolution, so it is informative at regional scale and
  heavily upsampled at street scale.
- Zone heat metrics come from the bundled profiles in `backend/data/`, not from
  a live satellite feed.

## Notes on this build

Fixes applied that also affect the original project on Windows:

- `print()` of status emoji crashed startup under the cp1252 console encoding;
  stdout/stderr are now reconfigured to UTF-8.
- Every `open()` on a data file now passes `encoding="utf-8"`. Without it,
  `interventions.json` failed to load and `/api/zones/{id}` returned 500.
- The CARTO `dark_all` basemap now watermarks every tile with "API KEY
  REQUIRED"; swapped to keyless Esri Dark Gray Canvas.

The production bundle is large (~4.9 MB, 1.3 MB gzipped) because Cesium ships a
lot. Code-splitting the globe behind a dynamic import is the obvious next step.
