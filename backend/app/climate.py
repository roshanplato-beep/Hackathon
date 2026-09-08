"""
Measured climate data from verified public APIs.

Exists to replace invented constants with real observations, and to make the
difference between the two auditable from the API response.

Sources, both keyless and citable:

  NASA POWER    https://power.larc.nasa.gov/  — Earth skin temperature (TS) and
                2m air temperature (T2M), MERRA-2 reanalysis climatology.
                Authoritative and free, but the grid is ~0.5 degrees (~50km):
                every Chennai ward falls in one cell and returns an identical
                value. Usable as a city baseline, useless for ward contrast.

  Open-Meteo    https://open-meteo.com/  — live 2m air temperature on a ~11km
                grid. Real and current, but air temperature is not surface
                temperature, and no weather model resolves an urban canopy.

Neither can supply measured per-ward land surface temperature. That needs MODIS
or Landsat pixel values, which require NASA Earthdata credentials (AppEEARS) or
Google Earth Engine. Until those are configured, ward-level contrast comes from
the morphology model in heat_engine, and every response says so.
"""
import json
import time
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "climate_cache.json"
CACHE_TTL_DAYS = 30

POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

_LIVE_CACHE = {}

CHENNAI = {"latitude": 13.0, "longitude": 80.22}

MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
              "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# Used only if NASA POWER is unreachable. Flagged as unverified wherever it is
# surfaced, so a fallback can never masquerade as a measurement.
FALLBACK_BASELINE_C = 28.8


def _read_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_cache(payload: dict) -> None:
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except Exception:
        pass


def _cache_fresh(entry: dict) -> bool:
    try:
        stamped = datetime.fromisoformat(entry["fetched_at"])
        return (datetime.now(timezone.utc) - stamped).days < CACHE_TTL_DAYS
    except Exception:
        return False


async def fetch_power_climatology(latitude: float, longitude: float) -> Optional[dict]:
    """
    Monthly Earth skin temperature and 2m air temperature climatology.

    Returns None when POWER cannot be reached, so callers can fall back openly
    rather than silently substituting a number.
    """
    params = {
        "parameters": "TS,T2M",
        "community": "RE",
        "latitude": latitude,
        "longitude": longitude,
        "format": "JSON",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(POWER_URL, params=params)
            res.raise_for_status()
            body = res.json()
        param = body["properties"]["parameter"]
        return {
            "skin_temp_c": param["TS"],
            "air_temp_c": param["T2M"],
            "grid": body.get("geometry", {}).get("coordinates", [])[:2],
        }
    except Exception as e:
        print(f"NASA POWER unavailable: {e}")
        return None


async def get_city_baseline(force: bool = False) -> dict:
    """
    Chennai's measured annual-mean skin temperature, plus the warmest month.

    This replaces the previously hardcoded 33.6 C baseline constant, which did
    not come from any retrievable source.
    """
    cache = _read_cache()
    entry = cache.get("chennai_baseline")
    if entry and not force and _cache_fresh(entry):
        return entry

    power = await fetch_power_climatology(CHENNAI["latitude"], CHENNAI["longitude"])
    if not power:
        return {
            "annual_mean_skin_c": FALLBACK_BASELINE_C,
            "peak_month": None,
            "peak_month_skin_c": None,
            "measured": False,
            "source": "fallback constant (NASA POWER unreachable)",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    skin = power["skin_temp_c"]
    monthly = {m: skin[m] for m in MONTH_KEYS if m in skin}
    peak_month = max(monthly, key=monthly.get) if monthly else None

    record = {
        "annual_mean_skin_c": skin.get("ANN"),
        "annual_mean_air_c": power["air_temp_c"].get("ANN"),
        "monthly_skin_c": monthly,
        "peak_month": peak_month,
        "peak_month_skin_c": monthly.get(peak_month) if peak_month else None,
        "grid_point": power["grid"],
        "measured": True,
        "source": "NASA POWER (MERRA-2) climatology, parameter TS",
        "source_url": "https://power.larc.nasa.gov/",
        "resolution_note": (
            "~0.5 degree grid (~50km). One cell covers all of Chennai, so this "
            "is a city baseline and cannot differentiate wards."
        ),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    cache["chennai_baseline"] = record
    _write_cache(cache)
    return record


async def fetch_live_air_temps(points: list[tuple[float, float]]) -> list[dict]:
    """
    Live 2m air temperature for many points in a single Open-Meteo call.

    Air temperature, explicitly not surface temperature — callers must label it
    as such.
    """
    if not points:
        return []
    cache_key = tuple(points)
    cached = _LIVE_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < 600:
        return [dict(r, status="cached") for r in cached[1]]
    lats = ",".join(f"{p[0]:.4f}" for p in points)
    lons = ",".join(f"{p[1]:.4f}" for p in points)
    params = {
        "latitude": lats,
        "longitude": lons,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m",
        "timezone": "UTC",
        "wind_speed_unit": "ms",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(OPEN_METEO_URL, params=params)
            res.raise_for_status()
            body = res.json()
    except Exception as e:
        print(f"Open-Meteo unavailable: {e}")
        return [dict(r, status="stale") for r in cached[1]] if cached else []

    entries = body if isinstance(body, list) else [body]
    out = []
    for requested, got in zip(points, entries):
        current = got.get("current", {})
        if not isinstance(current.get("temperature_2m"), (int, float)) or not math.isfinite(current["temperature_2m"]):
            return []
        out.append({
            "requested": {"latitude": requested[0], "longitude": requested[1]},
            "grid": {"latitude": got.get("latitude"), "longitude": got.get("longitude")},
            "elevation_m": got.get("elevation"),
            "air_temp_c": current.get("temperature_2m"),
            "apparent_temp_c": current.get("apparent_temperature"),
            "humidity_pct": current.get("relative_humidity_2m"),
            "wind_speed_mps": current.get("wind_speed_10m"),
            "status": "current",
            "observed_at": current.get("time"),
            "measured": False,
            "data_kind": "weather_model",
            "quantity": "2m air temperature",
            "source": "Open-Meteo",
            "source_url": "https://open-meteo.com/",
        })
    _LIVE_CACHE[cache_key] = (time.time(), out)
    return out


def provenance() -> dict:
    """
    Field-by-field statement of what is measured and what is modelled.

    Served with the zone payloads so the distinction travels with the data
    instead of living only in documentation.
    """
    return {
        "measured": {
            "building_density_pct": "OpenStreetMap via Overpass API",
            "green_cover_pct": "OpenStreetMap via Overpass API",
            "road_coverage_pct": "OpenStreetMap via Overpass API",
            "water_proximity_m": "OpenStreetMap via Overpass API",
            "govt_land_area_sqm": "OpenStreetMap via Overpass API",
            "city_baseline_skin_temp_c": "NASA POWER (MERRA-2) climatology",
            "air_temp_c": "Open-Meteo live observation (when requested)",
            "thermal_overlay": "NASA EOSDIS GIBS, MODIS/Aqua land surface temperature",
        },
        "modelled": {
            "lst_celsius": (
                "Morphology model: measured city baseline, adjusted by measured "
                "OSM building density, green cover, road coverage and water "
                "proximity. Not a satellite pixel reading."
            ),
            "ndvi": (
                "Linear proxy from measured OSM green cover, not a spectral "
                "index from satellite bands."
            ),
            "heat_risk_score": "Weighted index over the fields above.",
            "intervention_temp_drop": (
                "Published literature values per intervention type, see each "
                "intervention's source field."
            ),
        },
        "not_available_without_credentials": {
            "measured_ward_level_lst": (
                "Per-ward land surface temperature at 1km requires MODIS or "
                "Landsat pixel values via NASA Earthdata (AppEEARS) or Google "
                "Earth Engine. Both need an account; neither is keyless."
            ),
        },
    }
