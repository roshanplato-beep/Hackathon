"""
Planning workspace: itemised cost estimates, saved intervention plans, and
field survey records.

Backs the Site Planner, Cost Estimate and Mobile Survey screens. Estimates are
computed from the same intervention data the recommender uses, so a plan and its
price never disagree. Plans and surveys persist to JSON files beside the zone
data — adequate for a single-user planning tool, and easy to inspect. Where that
directory is read-only (serverless), they fall back to the temp dir.
"""
import json
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

DATA_DIR = Path(__file__).parent.parent / "data"


def _store_dir() -> Path:
    """Directory that actually accepts writes.

    Serverless bundles mount the deployment read-only, so writing beside the
    zone data raises OSError there. Fall back to the temp dir: saves become
    per-instance rather than durable, but the endpoints answer instead of 500ing.
    """
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        probe = DATA_DIR / ".write-probe"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
        return DATA_DIR
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "heatscape"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


STORE_DIR = _store_dir()
PLANS_FILE = STORE_DIR / "zone_plans.json"
SURVEYS_FILE = STORE_DIR / "zone_surveys.json"

# Indian municipal procurement conventions, applied on top of raw material cost.
DEFAULT_INSTALLATION_PCT = 18.0
DEFAULT_SITEWORK_PCT = 12.0
DEFAULT_CONTINGENCY_PCT = 10.0


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write(path: Path, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# Cost estimation
# --------------------------------------------------------------------------- #

class EstimateRequest(BaseModel):
    zone_id: str
    intervention_ids: list[str] = []
    # Per-intervention coverage in square metres. Missing entries fall back to
    # the recommender's estimated_area_sqm.
    areas_sqm: dict[str, float] = {}
    installation_pct: float = Field(default=DEFAULT_INSTALLATION_PCT, ge=0, le=200)
    sitework_pct: float = Field(default=DEFAULT_SITEWORK_PCT, ge=0, le=200)
    contingency_pct: float = Field(default=DEFAULT_CONTINGENCY_PCT, ge=0, le=100)


def build_estimate(zone: dict, interventions: list[dict], req: EstimateRequest) -> dict:
    """
    Itemise a plan: material from rate x area, then installation, site work and
    contingency as percentages of the material subtotal.
    """
    chosen = [i for i in interventions if i["id"] in req.intervention_ids]

    line_items = []
    material_total = 0.0
    total_area = 0.0
    combined_drop = 0.0

    for intv in chosen:
        area = float(req.areas_sqm.get(intv["id"], intv.get("estimated_area_sqm", 0)) or 0)
        rate = float(intv.get("cost_per_sqm_inr", 0) or 0)
        # Some recommendations are priced per tree, shade unit or metre, not
        # per square metre. Preserve their recommender cost instead of showing 0.
        cost = area * rate if rate else float(intv.get("estimated_cost_inr", 0) or 0)
        material_total += cost
        total_area += area
        drop = float(intv.get("temp_drop", 0) or 0)
        if rate and intv["id"] in req.areas_sqm:
            drop *= max(0, area) / max(float(intv.get("estimated_area_sqm", 0)), 1)
            drop = min(drop, float(intv.get("local_reference_drop_c", drop)))
        combined_drop += drop
        line_items.append({
            "id": intv["id"],
            "name": intv["name"],
            "category": intv["category"],
            "icon": intv.get("icon", ""),
            "area_sqm": round(area, 1),
            "rate_inr_per_sqm": rate,
            "quantity": round(area, 1) if rate else 1,
            "unit": "m²" if rate else "recommended package",
            "unit_rate_inr": rate if rate else cost,
            "amount_inr": round(cost, 2),
            "temp_drop_c": drop,
            "authority": intv.get("authority", "zone"),
            "source": intv.get("source", ""),
        })

    installation = material_total * req.installation_pct / 100
    sitework = material_total * req.sitework_pct / 100
    subtotal = material_total + installation + sitework
    contingency = subtotal * req.contingency_pct / 100
    total = subtotal + contingency

    population = float(zone.get("estimated_population", 0) or 0)

    # Interventions overlap rather than stack cleanly, so damp the naive sum
    # instead of promising the arithmetic total.
    projected_drop = round(combined_drop * 0.75, 2) if len(chosen) > 1 else round(combined_drop, 2)

    return {
        "zone_id": zone["id"],
        "zone_name": zone["name"],
        "line_items": line_items,
        "totals": {
            "material_inr": round(material_total, 2),
            "installation_inr": round(installation, 2),
            "installation_pct": req.installation_pct,
            "sitework_inr": round(sitework, 2),
            "sitework_pct": req.sitework_pct,
            "subtotal_inr": round(subtotal, 2),
            "contingency_inr": round(contingency, 2),
            "contingency_pct": req.contingency_pct,
            "total_inr": round(total, 2),
        },
        "impact": {
            "total_area_sqm": round(total_area, 1),
            "projected_temp_drop_c": projected_drop,
            "people_benefiting": int(population),
            "cost_per_person_inr": round(total / population, 2) if population else None,
        },
        "notice": (
            "Concept estimates using unverified catalogue rates and assumed installation allowances. "
            "Cooling is area-weighted model output; population is a building-count proxy, "
            "not verified beneficiaries. Local quotes, ownership checks and validation required."
        ),
    }


# --------------------------------------------------------------------------- #
# Saved plans
# --------------------------------------------------------------------------- #

class PlanRequest(BaseModel):
    zone_id: str
    intervention_ids: list[str] = []
    areas_sqm: dict[str, float] = {}
    notes: str = ""


def save_plan(req: PlanRequest) -> dict:
    plans = _read(PLANS_FILE)
    record = {
        "zone_id": req.zone_id,
        "intervention_ids": req.intervention_ids,
        "areas_sqm": req.areas_sqm,
        "notes": req.notes,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    plans[req.zone_id] = record
    _write(PLANS_FILE, plans)
    return record


def get_plan(zone_id: str) -> Optional[dict]:
    return _read(PLANS_FILE).get(zone_id)


def list_plans() -> list[dict]:
    return list(_read(PLANS_FILE).values())


# --------------------------------------------------------------------------- #
# Field surveys
# --------------------------------------------------------------------------- #

class SurveyRequest(BaseModel):
    zone_id: str
    site_name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    surveyed_at: str = ""
    observed_shade_pct: Optional[float] = Field(default=None, ge=0, le=100)
    crowd_count: Optional[int] = Field(default=None, ge=0)
    observation_period: str = ""
    surface_type: str = ""
    heat_contributors: list[str] = []
    notes: str = ""


def save_survey(req: SurveyRequest) -> dict:
    surveys = _read(SURVEYS_FILE)
    records = surveys.get("records", [])
    record = req.model_dump()
    record["id"] = uuid.uuid4().hex
    record["created_at"] = datetime.now(timezone.utc).isoformat()
    records.append(record)
    _write(SURVEYS_FILE, {"records": records})
    return record


def list_surveys(zone_id: Optional[str] = None) -> list[dict]:
    records = _read(SURVEYS_FILE).get("records", [])
    if zone_id:
        return [r for r in records if r.get("zone_id") == zone_id]
    return records
