"""Run from the repository root: python -m unittest discover -s backend -p test_vr.py"""
import unittest
import sys
import json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from app.planning import build_estimate, EstimateRequest
from fastapi.testclient import TestClient
from app.main import app

class VRTests(unittest.TestCase):
    def test_api_bootstrap_and_cost_parity(self):
        with TestClient(app) as client:
            response=client.get('/api/vr/bootstrap')
            self.assertEqual(response.status_code,200)
            profiles=response.json()['profiles']
            self.assertEqual(len(profiles),18)
            for zid, detail in profiles.items():
                recommendations=detail['interventions']
                for mask in range(8):
                    selected=[i for n,i in enumerate(recommendations) if mask & (1<<n)]
                    estimate=build_estimate(detail['zone'],recommendations,EstimateRequest(zone_id=zid,intervention_ids=[i['id'] for i in selected]))
                    self.assertAlmostEqual(estimate['totals']['total_inr'],round(sum(i['estimated_cost_inr'] for i in selected)*1.3*1.1,2))
                    self.assertAlmostEqual(estimate['impact']['projected_temp_drop_c'],round(sum(i['temp_drop'] for i in selected)*(0.75 if len(selected)>1 else 1),2))
            self.assertEqual(client.get('/api/zones').status_code,200)
            self.assertEqual(client.post('/api/estimate',json={'zone_id':'not-a-zone','intervention_ids':[]}).status_code,404)

if __name__=='__main__':unittest.main()
