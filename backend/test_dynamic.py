import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from app.heat_engine import build_all_profiles, select_interventions, simulate_intervention
from app.planning import build_estimate, EstimateRequest


class DynamicTests(unittest.TestCase):
    def test_location_quantities_and_costs_change(self):
        zones = build_all_profiles()
        signatures = set()
        for zid, zone in zones.items():
            recommendations = select_interventions(zone)
            signatures.add(tuple((i["id"], i["estimated_cost_inr"]) for i in recommendations))
            for item in recommendations:
                self.assertLessEqual(item["area_affected_sqm"], zone["zone_area_sqm"])
                self.assertGreaterEqual(item["temp_drop"], 0)
                self.assertLessEqual(item["temp_drop"], item["local_reference_drop_c"])
                estimate = build_estimate(zone, recommendations, EstimateRequest(
                    zone_id=zid, intervention_ids=[item["id"]]))
                self.assertAlmostEqual(estimate["totals"]["material_inr"], item["estimated_cost_inr"])
                simulation = simulate_intervention(zones, zid, item["id"])
                self.assertAlmostEqual(simulation["total_temp_reduction"], item["temp_drop"])
        self.assertGreater(len(signatures), 12)

    def test_same_intervention_changes_with_site_area(self):
        zone = next(iter(build_all_profiles().values()))
        larger = dict(zone, zone_area_sqm=zone["zone_area_sqm"] * 1.5,
                      govt_land_area_sqm=zone["govt_land_area_sqm"] * 1.5)
        a = {i["id"]: i for i in select_interventions(zone)}
        b = {i["id"]: i for i in select_interventions(larger)}
        self.assertEqual(a.keys(), b.keys())
        for key in a:
            self.assertNotEqual(a[key]["estimated_cost_inr"], b[key]["estimated_cost_inr"])

if __name__ == "__main__":
    unittest.main()
