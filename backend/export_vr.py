"""Bundle a dated model snapshot as a network fallback; never label it live."""
import json
from pathlib import Path
from datetime import datetime, timezone
from app import heat_engine
from app.main import generate_fallback_diagnosis

root = Path(__file__).resolve().parent
cache = json.loads((root / 'data/climate_cache.json').read_text(encoding='utf-8'))
heat_engine.set_city_baseline(cache.get('chennai_baseline', {}))
zones = heat_engine.build_all_profiles()
import app.main as main
main.zone_profiles = zones
payload = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'baseline': heat_engine.BASELINE_PROVENANCE,
    'profiles': {key: {'zone': z, 'interventions': heat_engine.select_interventions(z),
                       'diagnosis': generate_fallback_diagnosis(key)['diagnosis']} for key, z in zones.items()},
}
destination = root.parent / 'frontend/public/vr/profiles.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
print(f'Exported {len(zones)} dated VR profiles')
