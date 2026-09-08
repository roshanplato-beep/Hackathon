"""
Heat calculation engine.
Computes LST, NDVI, heat risk scores, and intervention recommendations per zone.
"""
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

# City baseline surface temperature, in °C.
#
# This was hardcoded to 33.6 with a comment citing "2020 peer-reviewed mean",
# but no retrievable source. It is now overwritten at startup by a measured
# value from NASA POWER (MERRA-2 Earth skin temperature) via
# climate.get_city_baseline(); see set_city_baseline below. The value here is
# only the offline fallback, and is reported as unverified when it is used.
CITY_BASELINE_LST = 28.8

# Peak-month rather than annual mean is the planning-relevant anchor, so the
# resolved baseline usually lands higher than the fallback.
BASELINE_PROVENANCE = {
    "value_c": CITY_BASELINE_LST,
    "measured": False,
    "source": "offline fallback (NASA POWER not yet fetched)",
}

# Ward-scale surface UHI intensity between dense core and vegetated suburb.
# A model coefficient, not a measurement.
UHI_INTENSITY_MAX = 5.5   # °C, city center vs suburbs


def set_city_baseline(baseline: dict) -> None:
    """
    Adopt a measured city baseline fetched from NASA POWER.

    Called once at startup. Uses the warmest month, which is what heat planning
    is sized against, falling back to the annual mean.
    """
    global CITY_BASELINE_LST, BASELINE_PROVENANCE
    value = baseline.get("peak_month_skin_c") or baseline.get("annual_mean_skin_c")
    if value is None:
        return
    CITY_BASELINE_LST = float(value)
    BASELINE_PROVENANCE = {
        "value_c": CITY_BASELINE_LST,
        "measured": bool(baseline.get("measured")),
        "basis": "peak month" if baseline.get("peak_month_skin_c") else "annual mean",
        "month": baseline.get("peak_month"),
        "source": baseline.get("source"),
        "source_url": baseline.get("source_url"),
        "resolution_note": baseline.get("resolution_note"),
    }


def compute_lst(building_density_pct: float, green_cover_pct: float,
                water_proximity_m: float, road_coverage_pct: float) -> float:
    """
    Compute Land Surface Temperature using research-backed formula.
    zone_lst = city_baseline + (building_density × 5.5) - (green_cover × 4.0) - water_proximity_factor
    """
    bd = building_density_pct / 100.0
    gc = green_cover_pct / 100.0
    rc = road_coverage_pct / 100.0

    # Water proximity factor: closer water = more cooling (max 2°C drop within 300m)
    water_factor = max(0, 2.0 * (1 - water_proximity_m / 2000))

    # Road surface adds heat (asphalt absorbs solar radiation)
    road_factor = rc * 3.0

    lst = CITY_BASELINE_LST + (bd * UHI_INTENSITY_MAX) - (gc * 4.0) - water_factor + road_factor

    # Clamp to realistic Chennai range
    return round(max(28.0, min(46.0, lst)), 1)


def compute_ndvi(green_cover_pct: float) -> float:
    """Approximate NDVI from OSM green cover percentage."""
    return round(green_cover_pct / 100 * 0.8 + 0.05, 3)


def compute_heat_risk_score(lst: float, ndvi: float, building_density_pct: float,
                            water_proximity_m: float, road_coverage_pct: float) -> float:
    """
    Compute 0-100 heat risk score.
    score = (LST_normalized × 0.40) + (vegetation_deficit × 0.25) +
            (building_density × 0.15) + (water_distance × 0.10) + (road_coverage × 0.10)
    """
    lst_norm = max(0, min(100, (lst - 30) / (46 - 30) * 100))
    veg_deficit = (1 - ndvi) * 100
    bd = building_density_pct
    wd = min(water_proximity_m / 2000, 1) * 100
    rc = road_coverage_pct

    score = (lst_norm * 0.40) + (veg_deficit * 0.25) + (bd * 0.15) + (wd * 0.10) + (rc * 0.10)
    return round(max(0, min(100, score)), 1)


def get_heat_color(score: float) -> str:
    """Return hex color for heat risk score (blue to red gradient)."""
    if score >= 80:
        return "#dc2626"  # red-600
    elif score >= 65:
        return "#ea580c"  # orange-600
    elif score >= 50:
        return "#d97706"  # amber-600
    elif score >= 35:
        return "#ca8a04"  # yellow-600
    elif score >= 20:
        return "#3b82f6"  # blue-500
    else:
        return "#2563eb"  # blue-600


def get_heat_color_rgba(score: float, alpha: float = 0.6) -> str:
    """Return rgba color for map overlay."""
    if score >= 80:
        return f"rgba(220, 38, 38, {alpha})"
    elif score >= 65:
        return f"rgba(234, 88, 12, {alpha})"
    elif score >= 50:
        return f"rgba(217, 119, 6, {alpha})"
    elif score >= 35:
        return f"rgba(202, 138, 4, {alpha})"
    elif score >= 20:
        return f"rgba(59, 130, 246, {alpha})"
    else:
        return f"rgba(37, 99, 235, {alpha})"


def select_interventions(zone_profile: dict) -> list:
    """
    Select best intervention from each category (green, cool_surface, water).
    Returns list of 3 interventions with cost estimates.
    """
    with open(DATA_DIR / "interventions.json", encoding="utf-8") as f:
        all_interventions = json.load(f)

    bd = zone_profile["building_density_pct"]
    gc = zone_profile["green_cover_pct"]
    rc = zone_profile["road_coverage_pct"]
    wp = zone_profile["water_proximity_m"]
    gl = zone_profile.get("govt_land_area_sqm", 0)
    ndvi = zone_profile.get("ndvi", compute_ndvi(gc))
    zone_area = zone_profile.get("zone_area_sqm", 1000000)

    selected = []

    # GREEN category
    if gl > 500 and zone_profile.get("govt_land_pct", 0) > 3:
        green_pick = "pocket_park"
    else:
        green_pick = "tree_planting"

    intervention = all_interventions[green_pick].copy()
    if green_pick == "tree_planting":
        # Estimate: plant along roads in zone
        road_km = rc / 100 * math.sqrt(zone_area) / 1000 * 2  # rough road length
        num_trees = int(road_km * 10 * intervention["trees_per_100m_road"])
        intervention["estimated_trees"] = max(50, num_trees)
        intervention["estimated_cost_inr"] = intervention["estimated_trees"] * intervention["cost_per_tree_inr"]
        intervention["temp_drop"] = min(intervention["max_drop"],
                                        intervention["temp_drop_per_10pct_canopy"] * (intervention["estimated_trees"] * 25 / zone_area * 100 / 10))
        intervention["temp_drop"] = max(0.5, round(intervention["temp_drop"], 1))
    else:
        park_area = gl * 0.03  # Concept scenario: 3% of institutional land
        intervention["estimated_area_sqm"] = round(park_area, 0)
        intervention["estimated_cost_inr"] = round(intervention["estimated_area_sqm"] * intervention["cost_per_sqm_inr"])
        intervention["temp_drop"] = intervention["temp_drop"]

    intervention["area_affected_sqm"] = round(math.pi * intervention["effect_radius_m"] ** 2, 0)
    selected.append(intervention)

    # COOL SURFACE category
    if bd > 60:
        cool_pick = "cool_roof_lime"
    elif rc > 30:
        cool_pick = "reflective_road_paint"
    else:
        cool_pick = "shade_structures"

    intervention = all_interventions[cool_pick].copy()
    if cool_pick == "cool_roof_lime":
        roof_area = bd / 100 * zone_area * 0.1  # 10% of buildings
        intervention["estimated_area_sqm"] = round(roof_area, 0)
        intervention["estimated_cost_inr"] = round(intervention["estimated_area_sqm"] * intervention["cost_per_sqm_inr"])
        intervention["temp_drop"] = intervention["temp_drop_ambient"]
    elif cool_pick == "reflective_road_paint":
        road_area = rc / 100 * zone_area * 0.05  # 5% of roads
        intervention["estimated_area_sqm"] = round(road_area, 0)
        intervention["estimated_cost_inr"] = round(intervention["estimated_area_sqm"] * intervention["cost_per_sqm_inr"])
        intervention["temp_drop"] = intervention["temp_drop_ambient"]
    else:
        num_units = max(1, round(zone_area * rc / 100 * 0.005 / intervention["coverage_sqm_per_unit"]))
        intervention["estimated_units"] = num_units
        intervention["estimated_cost_inr"] = num_units * intervention["cost_per_unit_inr"]
        intervention["temp_drop"] = intervention["temp_drop_ambient"]

    intervention["area_affected_sqm"] = round(math.pi * intervention["effect_radius_m"] ** 2, 0)
    selected.append(intervention)

    # WATER category
    if wp < 500 and zone_profile.get("water_body_count", 0) > 0:
        water_pick = "water_body_restoration"
    elif rc > 20:
        water_pick = "permeable_paving"
    else:
        water_pick = "misting_corridor"

    intervention = all_interventions[water_pick].copy()
    if water_pick == "water_body_restoration":
        channel_length = round(math.sqrt(zone_area) * 0.1 * max(0, 1 - wp / 2000), 1)  # Survey required
        intervention["estimated_channel_m"] = channel_length
        intervention["estimated_cost_inr"] = channel_length * intervention["cost_per_meter_channel_inr"]
        intervention["temp_drop"] = intervention["temp_drop"]
    elif water_pick == "permeable_paving":
        pave_area = zone_area * rc / 100 * 0.05  # 5% of road footprint
        intervention["estimated_area_sqm"] = round(pave_area, 0)
        intervention["estimated_cost_inr"] = round(intervention["estimated_area_sqm"] * intervention["cost_per_sqm_inr"])
        intervention["temp_drop"] = intervention["temp_drop_ambient"]
    else:
        corridor_length = round(math.sqrt(zone_area) * rc / 100 * 0.2, 1)
        intervention["estimated_length_m"] = corridor_length
        intervention["estimated_cost_inr"] = round(corridor_length / 100 * intervention["cost_per_100m_inr"])
        intervention["temp_drop"] = intervention["temp_drop_ambient"]

    intervention["area_affected_sqm"] = round(math.pi * intervention["effect_radius_m"] ** 2, 0)
    selected.append(intervention)

    # Area-weighted concept scenario, not a validated temperature forecast.
    for intv in selected:
        local_drop = intv["temp_drop"]
        footprint = intv.get("estimated_area_sqm",
            intv.get("estimated_trees", 0) * 25
            or intv.get("estimated_units", 0) * intv.get("coverage_sqm_per_unit", 25)
            or intv.get("estimated_channel_m", 0) * 10
            or intv.get("estimated_length_m", 0) * 5)
        affected = min(zone_area, math.pi * intv["effect_radius_m"] ** 2, footprint * 10)
        intv["area_affected_sqm"] = round(affected, 1)
        intv["local_reference_drop_c"] = local_drop
        intv["temp_drop"] = round(local_drop * affected / max(zone_area, 1), 4)
        intv["planning_basis"] = (
            "Quantity × catalogue unit rate; rates are unverified planning assumptions, "
            "not live contractor quotes. Zone-average cooling = local reference × "
            "influence area / zone area. Influence area assumes 10× treated footprint, "
            "capped by reference radius and zone area; not a validated prediction."
        )
        intv["input_source"] = "OSM-derived mapped features" if zone_profile.get("osm_fetched") else "Fallback morphology assumptions"

    # Rank by cost efficiency
    for i, intv in enumerate(selected):
        temp_drop = intv.get("temp_drop", 0.5)
        cost = intv.get("estimated_cost_inr", 1)
        area = intv.get("area_affected_sqm", 1)
        intv["cost_efficiency"] = round(cost / max(temp_drop, 0.1) / max(area, 1) * 1000, 4)

    selected.sort(key=lambda x: x["cost_efficiency"])
    selected[0]["most_cost_efficient"] = True

    return selected


def build_zone_profile(zone: dict, osm_data: dict) -> dict:
    """Build complete zone profile with heat metrics."""
    zd = osm_data

    lst = compute_lst(
        zd["building_density_pct"],
        zd["green_cover_pct"],
        zd["water_proximity_m"],
        zd["road_coverage_pct"]
    )
    ndvi = compute_ndvi(zd["green_cover_pct"])
    heat_score = compute_heat_risk_score(
        lst, ndvi,
        zd["building_density_pct"],
        zd["water_proximity_m"],
        zd["road_coverage_pct"]
    )

    profile = {
        "id": zone["id"],
        "name": zone["name"],
        "center": zone["center"],
        "bounds": zone["bounds"],
        "type": zone["type"],
        "description": zone["description"],
        # OSM-derived data
        "building_density_pct": zd["building_density_pct"],
        "green_cover_pct": zd["green_cover_pct"],
        "road_coverage_pct": zd["road_coverage_pct"],
        "water_proximity_m": zd["water_proximity_m"],
        "govt_land_pct": zd["govt_land_pct"],
        "govt_land_area_sqm": zd["govt_land_area_sqm"],
        "zone_area_sqm": zd["zone_area_sqm"],
        "building_count": zd["building_count"],
        "water_body_count": zd["water_body_count"],
        # Computed metrics
        "lst_celsius": lst,
        "ndvi": ndvi,
        "heat_risk_score": heat_score,
        "heat_color": get_heat_color(heat_score),
        "heat_color_rgba": get_heat_color_rgba(heat_score),
        "risk_level": (
            "Critical" if heat_score >= 75 else
            "High" if heat_score >= 55 else
            "Moderate" if heat_score >= 35 else
            "Low"
        ),
        # Estimated population
        "estimated_households": zd["building_count"],
        "estimated_population": zd["building_count"] * 4.2,
        # Data source
        "baseline_lst": CITY_BASELINE_LST,
        "osm_fetched_at": zd.get("fetched_at"),
        "morphology_note": zd.get("source_note", "Fallback morphology assumptions; not surveyed"),
        "osm_fetched": zd.get("osm_fetched", False)
    }

    return profile


def build_all_profiles():
    """Build profiles for all zones."""
    with open(DATA_DIR / "chennai_zones.json", encoding="utf-8") as f:
        zones = json.load(f)

    osm_file = DATA_DIR / "zone_osm_data.json"
    if osm_file.exists():
        with open(osm_file, encoding="utf-8") as f:
            osm_data = json.load(f)
    else:
        # Generate fallback data
        from app.overpass import generate_fallback_data
        osm_data = {z["id"]: generate_fallback_data(z) for z in zones}

    profiles = {}
    for zone in zones:
        zd = osm_data.get(zone["id"])
        if not zd:
            from app.overpass import generate_fallback_data
            zd = generate_fallback_data(zone)
        profiles[zone["id"]] = build_zone_profile(zone, zd)

    return profiles


def simulate_intervention(zone_profiles: dict, zone_id: str, intervention_id: str) -> dict:
    """
    Simulate applying an intervention to a zone.
    Returns modified profiles for affected zones.
    """
    with open(DATA_DIR / "interventions.json", encoding="utf-8") as f:
        all_interventions = json.load(f)

    if intervention_id not in all_interventions:
        return {"error": f"Unknown intervention: {intervention_id}"}

    intervention = all_interventions[intervention_id]
    target = zone_profiles.get(zone_id)
    if not target:
        return {"error": f"Unknown zone: {zone_id}"}

    intervention = next((i for i in select_interventions(target)
                         if i["id"] == intervention_id), None)
    if intervention is None:
        return {"error": "Intervention is not a current recommendation for this zone"}

    # Get temperature drop
    temp_drop = intervention.get("temp_drop",
                 intervention.get("temp_drop_ambient",
                 intervention.get("max_drop", 1.0)))
    effect_radius = intervention.get("effect_radius_m", 300)

    affected_zones = {}

    for zid, profile in zone_profiles.items():
        dist = haversine(target["center"], profile["center"])

        if zid == zone_id:
            reduction = temp_drop
        elif dist <= effect_radius:
            reduction = temp_drop * max(0, 1 - (dist / effect_radius))
        else:
            continue

        if reduction <= 0:
            continue

        new_lst = profile["lst_celsius"] - reduction
        new_lst = round(new_lst, 4)
        new_score = compute_heat_risk_score(
            new_lst, profile["ndvi"],
            profile["building_density_pct"],
            profile["water_proximity_m"],
            profile["road_coverage_pct"]
        )

        affected_zones[zid] = {
            "original_lst": profile["lst_celsius"],
            "new_lst": new_lst,
            "temp_reduction": round(reduction, 4),
            "original_score": profile["heat_risk_score"],
            "new_score": new_score,
            "new_color": get_heat_color(new_score),
            "new_color_rgba": get_heat_color_rgba(new_score),
            "new_risk_level": (
                "Critical" if new_score >= 75 else
                "High" if new_score >= 55 else
                "Moderate" if new_score >= 35 else
                "Low"
            )
        }

    return {
        "intervention": intervention,
        "target_zone": zone_id,
        "affected_zones": affected_zones,
        "total_temp_reduction": round(temp_drop, 4),
        "effect_radius_m": effect_radius
    }


def haversine(coord1, coord2):
    """Distance in meters between two [lat, lon] pairs."""
    lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
    lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
