"""
NASA EOSDIS GIBS integration for land-surface temperature tiles.

Serves both the globe landing page and the 2D map: the frontend asks which
imagery date is actually published and gets back a ready-to-use tile template,
so the date logic lives in one place instead of being guessed in the browser.

Two layers are offered, because it matters a great deal which you pick:

  daily      MODIS/Aqua once-daily pass. Freshest, but a single day is riddled
             with swath gaps and cloud masking. Over Chennai a typical September
             tile is ~1% covered, which looks broken even though it is correct.
  composite  MODIS 8-day maximum composite. Up to a week behind, but gaps are
             filled by other passes — the same tile runs 30-45% covered. This is
             the sane default for looking at a city.

Deliberately the EPSG:3857 endpoint rather than EPSG:4326. GIBS geographic
matrix sets step 2, 3, 5, 10, 20... tiles across, which is not power-of-two and
which Cesium's GeographicTilingScheme would index incorrectly.
GoogleMapsCompatible_Level7 is 1, 2, 4, 8... at 256px — an exact fit for both
Cesium's WebMercatorTilingScheme and Leaflet's native projection.
"""
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "thermal_cache.json"
CACHE_TTL_HOURS = 6

GIBS_HOST = "https://gibs.earthdata.nasa.gov"
MATRIX_SET = "GoogleMapsCompatible_Level7"
TILE_SIZE = 256
MIN_ZOOM = 0
MAX_ZOOM = 7

OWM_TILE_HOST = "https://tile.openweathermap.org/map"

LAYERS = {
    "air": {
        "id": "temp_new",
        "provider": "owm",
        "label": "Air temperature",
        "quantity": "2m air temperature",
        "cadence": "live",
        "blurb": "Smooth global field including ocean. Weather-model output, updated continuously.",
        "attribution": "OpenWeatherMap — 2m air temperature",
        "needs_key": True,
        # OWM's underlying grid is coarse; past ~10 it is only upscaling.
        "max_zoom": 10,
    },
    "composite": {
        "id": "MODIS_Aqua_L3_Land_Surface_Temp_8Day_Day",
        "provider": "gibs",
        "label": "Surface temp, 8-day",
        "quantity": "land surface temperature",
        "cadence": "P8D",
        "blurb": "Measured satellite surface temperature. Land only, gaps filled across a week.",
        "attribution": "NASA EOSDIS GIBS — MODIS/Aqua Land Surface Temperature (Day)",
        "needs_key": False,
    },
    "daily": {
        "id": "MODIS_Aqua_Land_Surface_Temp_Day",
        "provider": "gibs",
        "label": "Surface temp, daily",
        "quantity": "land surface temperature",
        "cadence": "P1D",
        "blurb": "Freshest satellite pass, but heavily gapped by swaths and cloud.",
        "attribution": "NASA EOSDIS GIBS — MODIS/Aqua Land Surface Temperature (Day)",
        "needs_key": False,
    },
}

# The smooth continuous field is what people expect a "heat map of the world"
# to look like, so it leads. The MODIS layers stay available because they are
# genuine surface temperature, which is the quantity this app plans against.
DEFAULT_LAYER = "air"

# GIBS answers 404 for tiles with no coverage, so a single probe can produce a
# false negative on a swath gap. These two cover enormous, reliably-imaged land
# areas (Africa/Europe, and South Asia); a hit on either means the date is live.
PROBE_TILES = ((2, 1, 2), (4, 7, 11))

MAX_LOOKBACK = 10

# MODIS 8-day products run on a fixed grid of 46 periods per year, starting at
# day-of-year 1. Arbitrary dates are rejected, so candidates must snap to it.
PERIODS_PER_YEAR = 46

LEGEND = {
    "unit": "°C",
    "min": -33.0,
    "max": 67.0,
    "stops": [
        {"value": -33.0, "color": "#08084f"},
        {"value": 0.0, "color": "#3b82f6"},
        {"value": 20.0, "color": "#22d3ee"},
        {"value": 35.0, "color": "#fbbf24"},
        {"value": 50.0, "color": "#ef4444"},
        {"value": 67.0, "color": "#7f1d1d"},
    ],
    "note": "Colours follow the GIBS MODIS LST palette; values are indicative.",
}

ATTRIBUTION = "NASA EOSDIS GIBS — MODIS/Aqua Land Surface Temperature (Day)"


def resolve_layer(key: Optional[str]) -> tuple[str, dict]:
    k = (key or DEFAULT_LAYER).lower()
    if k not in LAYERS:
        k = DEFAULT_LAYER
    return k, LAYERS[k]


def owm_key() -> Optional[str]:
    return os.environ.get("OPENWEATHERMAP_API_KEY")


def tile_url(layer: dict, day: str, z: int, y: int, x: int) -> str:
    """Upstream URL for one tile. For OWM this embeds the key, so it must never
    be handed to a browser — only used server-side by the proxy."""
    if layer.get("provider") == "owm":
        return f"{OWM_TILE_HOST}/{layer['id']}/{z}/{x}/{y}.png?appid={owm_key()}"
    return (
        f"{GIBS_HOST}/wmts/epsg3857/best/{layer['id']}/default/{day}/"
        f"{MATRIX_SET}/{z}/{y}/{x}.png"
    )


def tile_template(key: str, layer: dict, day: str) -> str:
    """
    Template handed to the map client.

    GIBS is public, so clients hit it directly. OpenWeatherMap requires a key,
    so that layer is routed through this backend's proxy and the key stays
    server-side — a template with the key in it would leak on first request.
    """
    if layer.get("provider") == "owm":
        return f"/api/thermal/tile/{{z}}/{{y}}/{{x}}.png?layer={key}"
    return (
        f"{GIBS_HOST}/wmts/epsg3857/best/{layer['id']}/default/{day}/"
        f"{MATRIX_SET}/{{z}}/{{y}}/{{x}}.png"
    )


def _candidate_dates(cadence: str, today: date) -> list[str]:
    """Dates to try, newest first, snapped to the layer's publishing grid."""
    if cadence == "P1D":
        return [(today - timedelta(days=n)).isoformat() for n in range(1, MAX_LOOKBACK + 1)]

    year = today.year
    index = (today.timetuple().tm_yday - 1) // 8
    out = []
    while len(out) < MAX_LOOKBACK:
        if index < 0:
            year -= 1
            index = PERIODS_PER_YEAR - 1
        out.append((date(year, 1, 1) + timedelta(days=index * 8)).isoformat())
        index -= 1
    return out


def _read_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _cached_date(key: str) -> Optional[str]:
    entry = _read_cache().get(key)
    if not entry:
        return None
    try:
        stamped = datetime.fromisoformat(entry["timestamp"])
        if datetime.now(timezone.utc) - stamped < timedelta(hours=CACHE_TTL_HOURS):
            return entry.get("date")
    except Exception:
        pass
    return None


def _store_date(key: str, day: str) -> None:
    cache = _read_cache()
    cache[key] = {"timestamp": datetime.now(timezone.utc).isoformat(), "date": day}
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass


async def _is_published(client: httpx.AsyncClient, layer: dict, day: str) -> bool:
    for z, y, x in PROBE_TILES:
        try:
            res = await client.get(tile_url(layer, day, z, y, x))
            if res.status_code == 200 and res.headers.get("content-type", "").startswith("image/"):
                return True
        except Exception:
            continue
    return False


async def resolve_latest_date(key: Optional[str] = None, force: bool = False) -> tuple[str, str, bool]:
    """
    Newest date this layer actually serves imagery for.

    Returns (layer_key, date, verified). `verified` is False when every probe
    failed and we fell back to a fixed offset, which keeps the map usable
    offline.
    """
    key, layer = resolve_layer(key)

    # A live model field has no archive date to resolve.
    if layer["cadence"] == "live":
        return key, datetime.now(timezone.utc).isoformat(timespec="minutes"), True

    if not force:
        cached = _cached_date(key)
        if cached:
            return key, cached, True

    today = datetime.now(timezone.utc).date()
    candidates = _candidate_dates(layer["cadence"], today)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for day in candidates:
                if await _is_published(client, layer, day):
                    _store_date(key, day)
                    return key, day, True
    except Exception as e:
        print(f"GIBS probe failed: {e}")

    return key, candidates[0], False


async def build_config(key: Optional[str] = None) -> dict:
    """Everything a map client needs to render the thermal layer."""
    key, day, verified = await resolve_latest_date(key)
    layer = LAYERS[key]
    unavailable = layer.get("needs_key") and not owm_key()
    return {
        "layer": layer["id"],
        "layer_key": key,
        "layer_label": layer["label"],
        "quantity": layer["quantity"],
        "cadence": layer["cadence"],
        "date": day,
        "date_is_verified": verified,
        "unavailable": bool(unavailable),
        "unavailable_reason": (
            "OPENWEATHERMAP_API_KEY is not set, so the live air-temperature "
            "layer cannot be served." if unavailable else None
        ),
        "tile_url_template": tile_template(key, layer, day),
        "tile_url_is_relative": layer.get("provider") == "owm",
        "proxy_url_template": f"/api/thermal/tile/{{z}}/{{y}}/{{x}}.png?layer={key}",
        "matrix_set": MATRIX_SET,
        "projection": "EPSG:3857",
        "tile_size": TILE_SIZE,
        "min_zoom": MIN_ZOOM,
        "max_zoom": layer.get("max_zoom", MAX_ZOOM),
        "legend": LEGEND,
        "attribution": layer["attribution"],
        "available_layers": [
            {
                "key": k,
                "label": v["label"],
                "quantity": v["quantity"],
                "cadence": v["cadence"],
                "blurb": v["blurb"],
                "unavailable": bool(v.get("needs_key") and not owm_key()),
            }
            for k, v in LAYERS.items()
        ],
        "notes": (
            "Live weather-model air temperature, continuous over land and ocean."
            if layer["provider"] == "owm"
            else "Measured satellite surface temperature, land only. Dark areas "
                 "are gaps between swaths or cloud masking, not missing heat."
        ),
    }


def _opacify(png: bytes, factor: float = 3.4) -> bytes:
    """
    Raise a tile's alpha channel.

    OpenWeatherMap bakes its temperature tiles at a flat 30% opacity because
    they are meant to sit lightly over a basemap. Rendered as the subject of the
    view they look washed out, and no client-side alpha can recover it — the
    ceiling is the alpha already in the PNG. Scaling it here is the only place
    the fix belongs, since this proxy already handles every one of these tiles.

    Returns the original bytes untouched if Pillow is unavailable.
    """
    try:
        import io

        from PIL import Image
    except ImportError:
        return png

    try:
        with Image.open(io.BytesIO(png)) as im:
            im = im.convert("RGBA")
            alpha = im.getchannel("A").point(lambda a: min(255, int(a * factor)))
            im.putalpha(alpha)
            out = io.BytesIO()
            im.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except Exception:
        return png


async def fetch_tile(
    z: int, y: int, x: int, key: Optional[str] = None, day: Optional[str] = None
) -> tuple[int, bytes, str]:
    """
    Proxy one tile. Returns (status, body, content_type).

    A 404 from GIBS means no coverage for that tile, which is normal; callers
    should treat it as an empty tile, not a failure.
    """
    key, layer = resolve_layer(key)
    if layer.get("needs_key") and not owm_key():
        return 503, b"", "text/plain"
    if day is None:
        _, day, _ = await resolve_latest_date(key)
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(tile_url(layer, day, z, y, x))
        body = res.content
        if res.status_code == 200 and layer.get("provider") == "owm":
            body = _opacify(body)
        return (
            res.status_code,
            body,
            res.headers.get("content-type", "application/octet-stream"),
        )
