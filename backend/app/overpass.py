"""
Overpass API data fetcher for Chennai urban zones.
Fetches building density, green cover, water proximity, road coverage, and govt land.
"""
import httpx
import json
import math
import asyncio
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DATA_DIR = Path(__file__).parent.parent / "data"


def build_overpass_query(south: float, west: float, north: float, east: float) -> str:
    """Build Overpass QL query for a bounding box."""
    bbox = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:30];
(
  // Buildings
  way["building"]({bbox});
  relation["building"]({bbox});

  // Green spaces
  way["leisure"="park"]({bbox});
  way["landuse"="grass"]({bbox});
  way["landuse"="forest"]({bbox});
  way["natural"="wood"]({bbox});
  way["leisure"="garden"]({bbox});
  way["landuse"="recreation_ground"]({bbox});
  relation["leisure"="park"]({bbox});
  relation["landuse"="forest"]({bbox});

  // Water bodies
  way["natural"="water"]({bbox});
  way["waterway"]({bbox});
  relation["natural"="water"]({bbox});
  way["water"]({bbox});

  // Roads
  way["highway"~"primary|secondary|tertiary|trunk|motorway|residential|unclassified"]({bbox});

  // Government / institutional land
  way["landuse"="government"]({bbox});
  way["landuse"="institutional"]({bbox});
  way["amenity"="school"]({bbox});
  way["amenity"="hospital"]({bbox});
  way["amenity"="college"]({bbox});
  way["amenity"="university"]({bbox});
  relation["landuse"="government"]({bbox});
  relation["landuse"="institutional"]({bbox});
);
out body;
>;
out skel qt;
"""


def estimate_way_area(nodes_map: dict, node_refs: list) -> float:
    """Estimate area of a closed way using the Shoelace formula (in sq meters approx)."""
    if len(node_refs) < 3:
        return 0.0
    coords = []
    for ref in node_refs:
        if ref in nodes_map:
            n = nodes_map[ref]
            coords.append((n["lat"], n["lon"]))
    if len(coords) < 3:
        return 0.0
    # Check if closed polygon
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    # Approximate using lat/lon to meters
    area = 0.0
    for i in range(len(coords) - 1):
        lat1, lon1 = coords[i]
        lat2, lon2 = coords[i + 1]
        # Convert to meters (approximate at Chennai latitude ~13°N)
        x1 = lon1 * 111320 * math.cos(math.radians(13.0))
        y1 = lat1 * 110540
        x2 = lon2 * 111320 * math.cos(math.radians(13.0))
        y2 = lat2 * 110540
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def estimate_way_length(nodes_map: dict, node_refs: list) -> float:
    """Estimate length of a way in meters."""
    length = 0.0
    for i in range(len(node_refs) - 1):
        if node_refs[i] in nodes_map and node_refs[i + 1] in nodes_map:
            n1 = nodes_map[node_refs[i]]
            n2 = nodes_map[node_refs[i + 1]]
            dlat = (n2["lat"] - n1["lat"]) * 110540
            dlon = (n2["lon"] - n1["lon"]) * 111320 * math.cos(math.radians(13.0))
            length += math.sqrt(dlat ** 2 + dlon ** 2)
    return length


def haversine_distance(lat1, lon1, lat2, lon2):
    """Distance in meters between two lat/lon points."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def compute_zone_bbox_area(south, west, north, east):
    """Approximate area of a bounding box in sq meters."""
    width = haversine_distance(south, west, south, east)
    height = haversine_distance(south, west, north, west)
    return width * height


async def fetch_zone_data(zone: dict) -> dict:
    """Fetch and process OSM data for a single zone."""
    bounds = zone["bounds"]
    south, west = bounds[0]
    north, east = bounds[1]
    zone_area = compute_zone_bbox_area(south, west, north, east)

    query = build_overpass_query(south, west, north, east)

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            data = None
            for endpoint in (OVERPASS_URL, "https://maps.mail.ru/osm/tools/overpass/api/interpreter"):
                try:
                    response = await client.get(endpoint, params={"data": query})
                    response.raise_for_status()
                    candidate = response.json()
                    if candidate.get("remark") or not candidate.get("elements"):
                        raise ValueError("Incomplete or empty OSM response")
                    data = candidate
                    break
                except (httpx.HTTPError, ValueError):
                    continue
            if data is None:
                raise ValueError("OSM endpoints unavailable")
    except Exception as e:
        print(f"  ⚠️  Overpass failed for {zone['name']}: {e}")
        return generate_fallback_data(zone)

    elements = data.get("elements", [])

    # Build nodes map
    nodes_map = {}
    for el in elements:
        if el["type"] == "node":
            nodes_map[el["id"]] = {"lat": el["lat"], "lon": el["lon"]}

    # Classify ways
    building_area = 0.0
    green_area = 0.0
    road_length = 0.0
    water_locations = []
    govt_land_area = 0.0
    water_area = 0.0

    for el in elements:
        if el["type"] != "way":
            continue
        tags = el.get("tags", {})
        nodes = el.get("nodes", [])

        if "building" in tags:
            building_area += estimate_way_area(nodes_map, nodes)
        elif tags.get("leisure") in ("park", "garden") or \
             tags.get("landuse") in ("grass", "forest", "recreation_ground") or \
             tags.get("natural") == "wood":
            green_area += estimate_way_area(nodes_map, nodes)
        elif tags.get("natural") == "water" or "waterway" in tags or "water" in tags:
            if "waterway" in tags:
                # Linear water feature — record midpoint
                mid_idx = len(nodes) // 2
                if nodes[mid_idx] in nodes_map:
                    n = nodes_map[nodes[mid_idx]]
                    water_locations.append((n["lat"], n["lon"]))
            else:
                water_area += estimate_way_area(nodes_map, nodes)
                # Record centroid
                lats = [nodes_map[n]["lat"] for n in nodes if n in nodes_map]
                lons = [nodes_map[n]["lon"] for n in nodes if n in nodes_map]
                if lats:
                    water_locations.append((sum(lats) / len(lats), sum(lons) / len(lons)))
        elif "highway" in tags:
            length = estimate_way_length(nodes_map, nodes)
            road_length += length
        elif tags.get("landuse") in ("government", "institutional") or \
             tags.get("amenity") in ("school", "hospital", "college", "university"):
            govt_land_area += estimate_way_area(nodes_map, nodes)

    # Calculate percentages
    building_density = min(building_area / zone_area * 100, 95) if zone_area > 0 else 50
    green_cover = min(green_area / zone_area * 100, 80) if zone_area > 0 else 5
    govt_land_pct = min(govt_land_area / zone_area * 100, 50) if zone_area > 0 else 2

    # Road coverage (assume average road width of 10m)
    road_area = road_length * 10
    road_coverage = min(road_area / zone_area * 100, 60) if zone_area > 0 else 15

    # Water proximity (distance from zone center to nearest water)
    center_lat, center_lon = zone["center"]
    if water_locations:
        water_distances = [haversine_distance(center_lat, center_lon, wl[0], wl[1]) for wl in water_locations]
        water_proximity = min(water_distances)
    else:
        water_proximity = 2000  # Default: no water nearby

    return {
        "building_density_pct": round(building_density, 1),
        "green_cover_pct": round(green_cover, 1),
        "road_coverage_pct": round(road_coverage, 1),
        "water_proximity_m": round(water_proximity, 0),
        "govt_land_pct": round(govt_land_pct, 1),
        "govt_land_area_sqm": round(govt_land_area, 0),
        "zone_area_sqm": round(zone_area, 0),
        "building_count": sum(1 for el in elements if el["type"] == "way" and "building" in el.get("tags", {})),
        "water_body_count": len(water_locations),
        "osm_fetched": True
    }


def generate_fallback_data(zone: dict) -> dict:
    """Generate realistic fallback data when Overpass fails."""
    # Research-backed defaults per zone type
    defaults = {
        "demo_hotspot": {
            "building_density_pct": 72.0, "green_cover_pct": 5.5,
            "road_coverage_pct": 28.0, "water_proximity_m": 1500,
            "govt_land_pct": 4.0
        },
        "secondary": {
            "building_density_pct": 55.0, "green_cover_pct": 12.0,
            "road_coverage_pct": 22.0, "water_proximity_m": 800,
            "govt_land_pct": 6.0
        },
        "cool_zone": {
            "building_density_pct": 15.0, "green_cover_pct": 55.0,
            "road_coverage_pct": 10.0, "water_proximity_m": 200,
            "govt_land_pct": 30.0
        }
    }
    zone_type = zone.get("type", "secondary")
    d = defaults.get(zone_type, defaults["secondary"])

    # Zone-specific overrides
    overrides = {
        "guindy_kathipara": {"building_density_pct": 45.0, "road_coverage_pct": 55.0, "green_cover_pct": 3.0},
        "koyambedu": {"building_density_pct": 68.0, "road_coverage_pct": 35.0, "green_cover_pct": 4.0},
        "mount_road": {"building_density_pct": 78.0, "road_coverage_pct": 32.0, "green_cover_pct": 3.5},
        "tambaram": {"building_density_pct": 70.0, "road_coverage_pct": 25.0, "green_cover_pct": 6.0},
        "meenambakkam": {"building_density_pct": 40.0, "road_coverage_pct": 38.0, "green_cover_pct": 8.0, "water_proximity_m": 1800},
        "t_nagar": {"building_density_pct": 75.0, "green_cover_pct": 4.0, "road_coverage_pct": 30.0, "water_proximity_m": 1200},
        "adyar": {"building_density_pct": 42.0, "green_cover_pct": 22.0, "road_coverage_pct": 18.0, "water_proximity_m": 300},
        "velachery": {"building_density_pct": 65.0, "green_cover_pct": 7.0, "road_coverage_pct": 25.0, "water_proximity_m": 600},
        "nungambakkam": {"building_density_pct": 62.0, "green_cover_pct": 9.0, "road_coverage_pct": 26.0, "water_proximity_m": 900},
        "perambur": {"building_density_pct": 68.0, "green_cover_pct": 6.0, "road_coverage_pct": 22.0, "water_proximity_m": 1100},
        "sholinganallur": {"building_density_pct": 48.0, "green_cover_pct": 14.0, "road_coverage_pct": 28.0, "water_proximity_m": 700},
        "anna_nagar": {"building_density_pct": 50.0, "green_cover_pct": 18.0, "road_coverage_pct": 20.0, "water_proximity_m": 500},
        "porur": {"building_density_pct": 38.0, "green_cover_pct": 20.0, "road_coverage_pct": 18.0, "water_proximity_m": 200},
        "mylapore": {"building_density_pct": 70.0, "green_cover_pct": 5.0, "road_coverage_pct": 24.0, "water_proximity_m": 400},
        "ambattur": {"building_density_pct": 58.0, "green_cover_pct": 10.0, "road_coverage_pct": 24.0, "water_proximity_m": 350},
        "iit_madras": {"building_density_pct": 10.0, "green_cover_pct": 72.0, "water_proximity_m": 150},
        "marina_beach": {"building_density_pct": 12.0, "green_cover_pct": 20.0, "water_proximity_m": 50},
        "adyar_eco_park": {"building_density_pct": 8.0, "green_cover_pct": 60.0, "water_proximity_m": 30},
    }

    if zone["id"] in overrides:
        d.update(overrides[zone["id"]])

    bounds = zone["bounds"]
    south, west = bounds[0]
    north, east = bounds[1]
    zone_area = compute_zone_bbox_area(south, west, north, east)

    return {
        **d,
        "govt_land_area_sqm": round(d["govt_land_pct"] / 100 * zone_area, 0),
        "zone_area_sqm": round(zone_area, 0),
        "building_count": int(d["building_density_pct"] * zone_area / 200 / 100),
        "water_body_count": 1 if d["water_proximity_m"] < 500 else 0,
        "osm_fetched": False
    }


async def fetch_all_zones():
    """Fetch data for all zones, with rate limiting."""
    zones_file = DATA_DIR / "chennai_zones.json"
    with open(zones_file, encoding="utf-8") as f:
        zones = json.load(f)

    results = {}
    for i, zone in enumerate(zones):
        print(f"  [{i+1}/{len(zones)}] Fetching {zone['name']}...")
        result = await fetch_zone_data(zone)
        results[zone["id"]] = result
        # Rate limit: Overpass has a 2 req/s limit
        if i < len(zones) - 1:
            await asyncio.sleep(1.5)

    return results


if __name__ == "__main__":
    results = asyncio.run(fetch_all_zones())
    output_file = DATA_DIR / "zone_osm_data.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\n✅ Saved OSM data to {output_file}")
