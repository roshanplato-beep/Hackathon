"""
HeatScape — Urban Heat Reduction Planner
FastAPI Backend
"""
import base64
import json
import os
import sys
from pathlib import Path

# Windows consoles default to cp1252, which cannot encode the status emoji this
# module prints on startup — without this the server dies before serving.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from app import heat_engine
from app.heat_engine import (
    build_all_profiles,
    select_interventions,
    simulate_intervention,
)
from app import climate
from app.weather import fetch_chennai_weather, get_zone_weather
from app import thermal
from app import planning
from app.planning import EstimateRequest, PlanRequest, SurveyRequest

# Load .env file from backend directory
load_dotenv(Path(__file__).parent.parent / ".env")

DATA_DIR = Path(__file__).parent.parent / "data"

# 1x1 transparent PNG, returned for thermal tiles GIBS has no coverage for.
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

app = FastAPI(
    title="HeatScape API",
    description="Urban Heat Reduction Planner for Chennai",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load zone profiles on startup
zone_profiles = {}
city_baseline = {}


@app.on_event("startup")
async def startup():
    global zone_profiles, city_baseline

    # Anchor the heat model to a measured baseline before any profile is built,
    # so no profile is ever derived from the offline fallback when the real
    # value is reachable.
    city_baseline = await climate.get_city_baseline()
    heat_engine.set_city_baseline(city_baseline)
    if city_baseline.get("measured"):
        print(
            f"Baseline: {heat_engine.CITY_BASELINE_LST}°C skin temp "
            f"({city_baseline.get('peak_month')}) — NASA POWER"
        )
    else:
        print("Baseline: NASA POWER unreachable, using unverified fallback")

    zone_profiles = build_all_profiles()
    print(f"✅ Loaded {len(zone_profiles)} zone profiles")

    # Check API keys
    if os.environ.get("GEMINI_API_KEY"):
        print("✅ Gemini API key loaded — AI diagnosis enabled")
    else:
        print("⚠️  No GEMINI_API_KEY — using computed fallback diagnosis")

    if os.environ.get("OPENWEATHERMAP_API_KEY"):
        print("✅ OpenWeatherMap API key loaded — live weather enabled")
    else:
        print("⚠️  No OPENWEATHERMAP_API_KEY — using Chennai summer averages")


@app.get("/api/provenance")
async def get_provenance():
    """
    Which fields are measured, which are modelled, and from what source.

    Served separately and embedded in /api/zones so a caller can always tell a
    satellite reading from a model output.
    """
    return {
        "baseline": heat_engine.BASELINE_PROVENANCE,
        "fields": climate.provenance(),
    }


@app.get("/api/climate/live")
async def get_live_climate(zone_id: Optional[str] = None):
    """
    Live measured 2m air temperature from Open-Meteo, for one zone or all.

    Air temperature, not surface temperature — the response says so, and the
    two must not be conflated in the UI.
    """
    targets = (
        [zone_profiles[zone_id]] if zone_id and zone_id in zone_profiles
        else list(zone_profiles.values())
    )
    if zone_id and zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

    points = [(z["center"][0], z["center"][1]) for z in targets]
    readings = await climate.fetch_live_air_temps(points)
    for zone, reading in zip(targets, readings):
        reading["zone_id"] = zone["id"]
        reading["zone_name"] = zone["name"]
    return {
        "readings": readings,
        "quantity": "2m air temperature",
        "note": (
            "Measured air temperature on a ~11km grid. Not land surface "
            "temperature, and too coarse to resolve ward-level heat islands."
        ),
    }


@app.get("/api/zones")
async def get_zones():
    """Get all zone profiles with heat data."""
    zones_list = list(zone_profiles.values())
    zones_list.sort(key=lambda z: z["heat_risk_score"], reverse=True)
    return {
        "zones": zones_list,
        "meta": {
            "total": len(zones_list),
            "city": "Chennai",
            "baseline_lst": heat_engine.CITY_BASELINE_LST,
            "baseline_provenance": heat_engine.BASELINE_PROVENANCE,
            "hotspots": [z["id"] for z in zones_list if z["heat_risk_score"] >= 55]
        },
        "provenance": climate.provenance(),
    }


@app.get("/api/zones/{zone_id}")
async def get_zone(zone_id: str):
    """Get detailed profile for a single zone including weather."""
    if zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    profile = zone_profiles[zone_id]
    interventions = select_interventions(profile)

    # Fetch weather data
    base_weather = await fetch_chennai_weather()
    zone_weather = get_zone_weather(base_weather, zone_id)

    return {
        "zone": profile,
        "interventions": interventions,
        "weather": zone_weather,
    }


class SimulationRequest(BaseModel):
    zone_id: str
    intervention_id: str


@app.post("/api/simulate")
async def simulate(req: SimulationRequest):
    """Simulate applying an intervention to a zone."""
    result = simulate_intervention(zone_profiles, req.zone_id, req.intervention_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


class DiagnosisRequest(BaseModel):
    zone_id: str


@app.post("/api/diagnose")
async def diagnose_zone(req: DiagnosisRequest):
    """Get AI diagnosis for a zone (requires Gemini API key)."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return generate_fallback_diagnosis(req.zone_id)

    profile = zone_profiles.get(req.zone_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Zone '{req.zone_id}' not found")

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        prompt = f"""You are an urban heat island expert analyzing Chennai, India.
Analyze this zone and explain WHY it is hot. Be specific to this zone.

Zone: {profile['name']}
Description: {profile['description']}
Land Surface Temperature: {profile['lst_celsius']}°C
Heat Risk Score: {profile['heat_risk_score']}/100
Building Density: {profile['building_density_pct']}%
Green Cover: {profile['green_cover_pct']}%
Road Coverage: {profile['road_coverage_pct']}%
Water Proximity: {profile['water_proximity_m']}m
NDVI: {profile['ndvi']}

Respond with this JSON structure:
{{
  "primary_cause": "Main reason this zone is hot (1 sentence)",
  "contributing_factors": ["factor1", "factor2", "factor3"],
  "urban_context": "How this zone's urban form creates heat (2-3 sentences mentioning specific features)",
  "vulnerable_populations": "Who is most affected (1 sentence)",
  "comparison": "How this compares to Chennai average of 33.6°C (1 sentence)"
}}"""

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        diagnosis = json.loads(response.text)
        return {"zone_id": req.zone_id, "diagnosis": diagnosis, "source": "gemini"}

    except Exception as e:
        print(f"Gemini error: {e}")
        return generate_fallback_diagnosis(req.zone_id)


class ReportRequest(BaseModel):
    zone_id: str
    interventions: list[str] = []


@app.post("/api/report")
async def generate_report(req: ReportRequest):
    """Generate a ward-level report using Gemini."""
    api_key = os.environ.get("GEMINI_API_KEY")
    profile = zone_profiles.get(req.zone_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Zone '{req.zone_id}' not found")

    interventions = select_interventions(profile)

    if not api_key:
        return generate_fallback_report(profile, interventions)

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        intv_text = json.dumps([{
            "name": i["name"],
            "category": i["category"],
            "temp_drop": i.get("temp_drop", 0),
            "estimated_cost_inr": i.get("estimated_cost_inr", 0),
            "authority": i["authority"],
            "source": i["source"]
        } for i in interventions], indent=2)

        prompt = f"""Generate a municipal ward-level heat mitigation report for {profile['name']}, Chennai.

Zone Data:
- Temperature: {profile['lst_celsius']}°C (city avg: 33.6°C)
- Heat Risk Score: {profile['heat_risk_score']}/100 ({profile['risk_level']})
- Building Density: {profile['building_density_pct']}%
- Green Cover: {profile['green_cover_pct']}%
- Estimated Population: {int(profile['estimated_population'])}
- Description: {profile['description']}

Recommended Interventions:
{intv_text}

Generate JSON with this structure:
{{
  "title": "Heat Mitigation Report — [Zone Name]",
  "executive_summary": "2-3 sentence overview",
  "current_situation": "3-4 sentences about current heat conditions",
  "recommendations": [
    {{
      "priority": 1,
      "intervention": "name",
      "action_steps": ["step1", "step2", "step3"],
      "timeline": "estimated timeline",
      "authority_needed": "ward/zone/city",
      "expected_impact": "temperature and population impact"
    }}
  ],
  "budget_summary": "Total estimated budget with breakdown",
  "implementation_notes": "2-3 sentences on phasing and quick wins"
}}"""

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        report = json.loads(response.text)
        return {"zone_id": req.zone_id, "report": report, "source": "gemini"}

    except Exception as e:
        print(f"Gemini error: {e}")
        return generate_fallback_report(profile, interventions)


@app.get("/api/weather")
async def get_weather():
    """Get current Chennai weather data."""
    weather = await fetch_chennai_weather()
    return {"weather": weather, "city": "Chennai"}


@app.get("/api/weather/{zone_id}")
async def get_weather_for_zone(zone_id: str):
    """Get weather data adjusted for a specific zone's microclimate."""
    if zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    base_weather = await fetch_chennai_weather()
    zone_weather = get_zone_weather(base_weather, zone_id)
    return {"weather": zone_weather, "zone_id": zone_id}


def generate_fallback_diagnosis(zone_id: str) -> dict:
    """Generate a structured diagnosis without Gemini."""
    profile = zone_profiles.get(zone_id, {})
    name = profile.get("name", zone_id)
    lst = profile.get("lst_celsius", 38)
    bd = profile.get("building_density_pct", 50)
    gc = profile.get("green_cover_pct", 10)
    rc = profile.get("road_coverage_pct", 20)

    factors = []
    if bd > 60:
        factors.append(f"High building density ({bd}%) traps heat and blocks wind corridors")
    if gc < 10:
        factors.append(f"Very low green cover ({gc}%) provides almost no evapotranspiration cooling")
    if rc > 25:
        factors.append(f"Extensive road surfaces ({rc}%) absorb and re-radiate solar energy")
    if gc >= 30:
        factors.append(f"Green cover ({gc}%) supports shade and evapotranspiration cooling")
    if profile.get("water_proximity_m", 2000) < 500:
        factors.append("Nearby water contributes a cooling term in the morphology model")
    if not factors:
        factors.append(f"The model balances {bd}% building coverage, {gc}% vegetation and {rc}% road coverage")
    baseline = heat_engine.CITY_BASELINE_LST
    delta = round(lst - baseline, 1)
    primary = (
        f"{name}'s {gc}% vegetation and {bd}% building coverage contribute to a cooler modelled microclimate."
        if gc >= 30 else
        f"{name}'s modelled surface temperature reflects {bd}% building coverage, {gc}% vegetation and {rc}% road coverage."
    )

    return {
        "zone_id": zone_id,
        "diagnosis": {
            "primary_cause": primary,
            "contributing_factors": factors,
            "urban_context": profile.get('description', 'Chennai study zone'),
            "vulnerable_populations": f"An estimated {int(profile.get('estimated_population', 0)):,} residents are exposed, with outdoor workers, elderly, and children most at risk.",
            "comparison": f"At {lst}°C, this zone is {abs(delta)}°C {'above' if delta >= 0 else 'below'} the {baseline:.2f}°C city planning baseline."
        },
        "source": "computed"
    }


def generate_fallback_report(profile: dict, interventions: list) -> dict:
    """Generate a structured report without Gemini."""
    recs = []
    for i, intv in enumerate(interventions):
        recs.append({
            "priority": i + 1,
            "intervention": intv["name"],
            "action_steps": [
                f"Survey {profile['name']} for suitable {intv['category']} intervention sites",
                f"Coordinate with {intv['authority']}-level authorities for approvals",
                f"Implement {intv['name'].lower()} targeting highest-temperature micro-zones"
            ],
            "timeline": f"{'3-6 months' if intv['authority'] == 'ward' else '6-12 months'}",
            "authority_needed": intv["authority"],
            "expected_impact": f"{intv.get('temp_drop', 'N/A')}°C reduction affecting {intv.get('area_affected_sqm', 0):,.0f} sqm"
        })

    total_cost = sum(i.get("estimated_cost_inr", 0) for i in interventions)

    return {
        "zone_id": profile["id"],
        "report": {
            "title": f"Heat Mitigation Report — {profile['name']}",
            "executive_summary": f"{profile['name']} has a heat risk score of {profile['heat_risk_score']}/100 with surface temperatures reaching {profile['lst_celsius']}°C. Immediate intervention with a combination of green, cool-surface, and water-based strategies can reduce temperatures by 1-3°C.",
            "current_situation": f"The zone covers approximately {profile['zone_area_sqm']:,.0f} sqm with {profile['building_density_pct']}% building density and only {profile['green_cover_pct']}% green cover. Current LST of {profile['lst_celsius']}°C exceeds Chennai's mean by {round(profile['lst_celsius'] - 33.6, 1)}°C. An estimated population of {int(profile['estimated_population']):,} is exposed to elevated heat stress.",
            "recommendations": recs,
            "budget_summary": f"Total estimated budget: ₹{total_cost:,.0f} across {len(interventions)} interventions",
            "implementation_notes": "Begin with ward-level interventions (cool roofs, tree planting) that require minimal approval. Phase larger projects (water body restoration, pocket parks) into next fiscal year budget cycle."
        },
        "source": "computed"
    }


@app.post("/api/estimate")
async def estimate(req: EstimateRequest):
    """Itemised cost estimate for a zone's selected interventions."""
    profile = zone_profiles.get(req.zone_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Zone '{req.zone_id}' not found")
    interventions = select_interventions(profile)
    return planning.build_estimate(profile, interventions, req)


@app.get("/api/plan/{zone_id}")
async def read_plan(zone_id: str):
    """The saved intervention plan for a zone, if one exists."""
    if zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    return {"zone_id": zone_id, "plan": planning.get_plan(zone_id)}


@app.post("/api/plan")
async def write_plan(req: PlanRequest):
    """Save the intervention plan for a zone."""
    if req.zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{req.zone_id}' not found")
    return {"plan": planning.save_plan(req)}


@app.get("/api/plans")
async def read_plans():
    return {"plans": planning.list_plans()}


@app.get("/api/surveys")
async def read_surveys(zone_id: Optional[str] = None):
    """Field survey records, optionally filtered to one zone."""
    return {"surveys": planning.list_surveys(zone_id)}


@app.post("/api/surveys")
async def write_survey(req: SurveyRequest):
    """Record an on-site field survey."""
    if req.zone_id not in zone_profiles:
        raise HTTPException(status_code=404, detail=f"Zone '{req.zone_id}' not found")
    return {"survey": planning.save_survey(req)}


@app.get("/api/thermal/config")
async def thermal_config(layer: Optional[str] = None):
    """
    Tile template and legend for the thermal layer, with the newest GIBS date
    that is actually published resolved server-side.

    `layer` selects 'composite' (8-day, the default) or 'daily'.
    """
    return await thermal.build_config(layer)


@app.get("/api/thermal/tile/{z}/{y}/{x}.png")
async def thermal_tile(
    z: int, y: int, x: int, layer: Optional[str] = None, date: Optional[str] = None
):
    """
    Proxy a GIBS tile. The globe normally hits GIBS directly; this exists as a
    fallback for networks that block the CDN, and keeps tile access same-origin.
    """
    _, spec = thermal.resolve_layer(layer)
    ceiling = spec.get("max_zoom", thermal.MAX_ZOOM)
    if not (thermal.MIN_ZOOM <= z <= ceiling):
        raise HTTPException(status_code=400, detail=f"zoom must be {thermal.MIN_ZOOM}-{ceiling}")

    status, body, content_type = await thermal.fetch_tile(z, y, x, layer, date)

    if status == 503:
        raise HTTPException(
            status_code=503,
            detail="OPENWEATHERMAP_API_KEY is not set; the live air-temperature layer is unavailable.",
        )

    # No coverage for this tile is normal (ocean, swath gap) — hand back a
    # transparent pixel so the client does not log it as an error.
    if status == 404:
        return Response(content=TRANSPARENT_PNG, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=3600"})
    if status != 200:
        raise HTTPException(status_code=502, detail=f"GIBS returned {status}")

    return Response(content=body, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/interventions")
async def get_interventions():
    """Get all available interventions."""
    with open(DATA_DIR / "interventions.json", encoding="utf-8") as f:
        interventions = json.load(f)
    return {"interventions": interventions}


@app.get("/api/vr/bootstrap")
async def vr_bootstrap():
    """Use the same recommender as 2D; no AI call is needed for VR startup."""
    return {
        "baseline": heat_engine.BASELINE_PROVENANCE,
        "profiles": {key: {
            "zone": profile,
            "interventions": select_interventions(profile),
            "diagnosis": generate_fallback_diagnosis(key)["diagnosis"],
        } for key, profile in zone_profiles.items()},
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "zones_loaded": len(zone_profiles),
        "gemini_configured": bool(os.environ.get("GEMINI_API_KEY")),
        "weather_configured": bool(os.environ.get("OPENWEATHERMAP_API_KEY")),
        "thermal_layers": list(thermal.LAYERS),
    }
