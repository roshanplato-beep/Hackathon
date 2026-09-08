"""
OpenWeatherMap API integration for live weather data.
Falls back to Chennai summer averages if no API key is set.
"""
import os
import json
import httpx
import asyncio
from pathlib import Path
from datetime import datetime, timedelta

DATA_DIR = Path(__file__).parent.parent / "data"
CACHE_FILE = DATA_DIR / "weather_cache.json"
CACHE_TTL_MINUTES = 30  # Cache weather data for 30 minutes

# Chennai summer averages (fallback)
CHENNAI_SUMMER_DEFAULTS = {
    "temp_celsius": 38.5,
    "feels_like_celsius": 42.0,
    "humidity_pct": 65,
    "wind_speed_mps": 4.2,
    "description": "Clear sky (summer average)",
    "icon": "01d",
    "source": "static_average"
}

# Zone-specific weather adjustments based on microclimate research
# Coastal zones are cooler, dense urban zones are hotter
ZONE_ADJUSTMENTS = {
    "marina_beach": {"temp_offset": -2.5, "humidity_offset": 10},
    "adyar_eco_park": {"temp_offset": -2.0, "humidity_offset": 8},
    "iit_madras": {"temp_offset": -1.8, "humidity_offset": 5},
    "adyar": {"temp_offset": -0.8, "humidity_offset": 3},
    "porur": {"temp_offset": -0.5, "humidity_offset": 2},
    "anna_nagar": {"temp_offset": -0.3, "humidity_offset": 0},
    "tambaram": {"temp_offset": 0.5, "humidity_offset": -3},
    "meenambakkam": {"temp_offset": 0.8, "humidity_offset": -5},
    "guindy_kathipara": {"temp_offset": 1.2, "humidity_offset": -5},
    "koyambedu": {"temp_offset": 1.0, "humidity_offset": -4},
    "mount_road": {"temp_offset": 1.5, "humidity_offset": -6},
    "t_nagar": {"temp_offset": 1.3, "humidity_offset": -5},
}


def _load_cache():
    """Load cached weather data if fresh enough."""
    if not CACHE_FILE.exists():
        return None
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            cache = json.load(f)
        cached_time = datetime.fromisoformat(cache.get("timestamp", "2000-01-01"))
        if datetime.now() - cached_time < timedelta(minutes=CACHE_TTL_MINUTES):
            return cache.get("data")
    except Exception:
        pass
    return None


def _save_cache(data):
    """Save weather data to cache."""
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "data": data
            }, f, indent=2)
    except Exception:
        pass


async def fetch_chennai_weather() -> dict:
    """
    Fetch current weather for Chennai from OpenWeatherMap.
    Returns base weather data for the city.
    """
    api_key = os.environ.get("OPENWEATHERMAP_API_KEY")
    if not api_key:
        return {**CHENNAI_SUMMER_DEFAULTS, "source": "static_average"}

    # Check cache first
    cached = _load_cache()
    if cached:
        return cached

    try:
        url = "https://api.openweathermap.org/data/2.5/weather"
        params = {
            "q": "Chennai,IN",
            "appid": api_key,
            "units": "metric"
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        weather = {
            "temp_celsius": round(data["main"]["temp"], 1),
            "feels_like_celsius": round(data["main"]["feels_like"], 1),
            "humidity_pct": data["main"]["humidity"],
            "wind_speed_mps": round(data["wind"]["speed"], 1),
            "description": data["weather"][0]["description"].title(),
            "icon": data["weather"][0]["icon"],
            "pressure_hpa": data["main"]["pressure"],
            "visibility_m": data.get("visibility", 10000),
            "source": "openweathermap_live"
        }

        _save_cache(weather)
        return weather

    except Exception as e:
        print(f"⚠️ OpenWeatherMap error: {e}")
        return {**CHENNAI_SUMMER_DEFAULTS, "source": "static_average"}


def get_zone_weather(base_weather: dict, zone_id: str) -> dict:
    """
    Adjust base city weather for a specific zone's microclimate.
    Urban heat islands make dense zones hotter; water/green zones cooler.
    """
    adjustments = ZONE_ADJUSTMENTS.get(zone_id, {"temp_offset": 0, "humidity_offset": 0})

    zone_weather = {
        **base_weather,
        "temp_celsius": round(base_weather["temp_celsius"] + adjustments["temp_offset"], 1),
        "feels_like_celsius": round(base_weather["feels_like_celsius"] + adjustments["temp_offset"] * 1.3, 1),
        "humidity_pct": max(20, min(95, base_weather["humidity_pct"] + adjustments["humidity_offset"])),
        "zone_adjusted": True,
    }

    # Heat index warning
    if zone_weather["feels_like_celsius"] >= 45:
        zone_weather["heat_warning"] = "Extreme Danger — heat stroke highly likely"
    elif zone_weather["feels_like_celsius"] >= 41:
        zone_weather["heat_warning"] = "Danger — heat exhaustion likely"
    elif zone_weather["feels_like_celsius"] >= 35:
        zone_weather["heat_warning"] = "Extreme Caution — heat cramps possible"

    return zone_weather
