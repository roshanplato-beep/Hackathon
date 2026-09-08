# HeatScape WebXR — demo handoff

Status: implemented and checked locally on 8 September 2026. Public deployment is **not completed**: Vercel CLI has no authenticated account. Physical Quest 2 testing is **not completed**. This is a working demo MVP, not a certification of headset performance or production readiness.

## Final project location

The final editable project is:

`C:\Users\rosha\Documents\Codex\2026-09-07\ran-page-script-waited-captured-page\work\heatscape-webxr`

The complete source is also in `heatscape-webxr.zip`. Extract it before running the commands below. The earlier project at `C:\Users\rosha\Documents\heatscape-integrated` was preserved; the final corrections are in this working copy because the session's write permissions changed. The old localhost:5174 server is not the final version.

Current local servers while this session remains running:

- Development UI: http://127.0.0.1:5175/ — API at http://127.0.0.1:8001/
- Built production preview: http://127.0.0.1:4174/?vr=1 — same local API through an optional preview proxy.
- These loopback URLs are for the laptop only, not URLs to enter in the headset.

## What is built

The existing React/Cesium globe, Leaflet workspace, planner, costs, and survey screens remain. VR is a separate, lazy-loaded Three.js WebXR experience; Cesium is also lazy-loaded and is unmounted during VR. No React rewrite or native headset application is required.

- All 18 existing Chennai study zones, with the original coordinates and profile data.
- Satellite-aligned Chennai tabletop, coastline, roads, water and mapped parks; 21,664 bundled OpenStreetMap building footprints sampled within 700 m of zone centres.
- Heat, green-cover and building layers, animated separation and reassembly.
- Controller trigger selection, grip move/two-grip scale and rotation; hand pinch selection and handle grabbing. Controllers are the fallback if hand tracking is not granted.
- In-world zone/profile/diagnosis/intervention panels, previous/next zone, before/after, reset, expand, home and exit.
- Controller flight, disabled initially. Left stick moves relative to view; right stick turns and changes altitude. Home returns to the tabletop.
- Project intervention recommendations, visible green/cool-surface/water concepts, cooling and cost totals calculated from the existing model.
- Timestamped Open-Meteo air weather with browser cache, request timeout and explicit unavailable state. No synthetic reading is substituted as live.
- Four visual onboarding prompts, synthesized ambience and effects, sound toggle; no narration.
- Desktop mouse preview and responsive controls. Desktop does not pretend to enter VR when unsupported.
- Bounded imagery, merged per-zone buildings, instanced intervention trees, distance-based geometry detail, capped desktop resolution and XR foveation. Geometry assembly yields periodically to update loading feedback.

## Run locally

Use Node.js 22.12+ (or a compatible newer version) and Python 3.11+. Python checks in this environment ran on 3.14.

In a terminal in the extracted project root:

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001
```

In a second terminal, also starting at the root:

```powershell
cd frontend
npm ci
$env:VITE_API_URL='http://127.0.0.1:8001'
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Open http://127.0.0.1:5175/?vr=1 for the hologram, or the root URL for the globe. Drag to orbit, wheel to zoom, select zones with the list or markers. Use Expand, Separate layers and Interventions.

Checks, from the project root:

```powershell
python -m unittest discover -s backend -p test_vr.py -v
cd frontend
npm test
npm run lint
# Do not bake a localhost API address into the hosted build.
Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
npm run build
$env:HEATSCAPE_PREVIEW_API='http://127.0.0.1:8001'
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

`HEATSCAPE_PREVIEW_API` only configures the local preview proxy. It is not required in Vercel.

## Vercel deployment — next action

Run `npx vercel login` in your own terminal and finish the browser sign-in. Then tell the agent that login is complete. Do not paste a token or password into chat.

The root `vercel.json` builds the Vite frontend and exposes the existing FastAPI app through `api/index.py`. Deploy **the repository root**, not only `frontend`. The intended next command after authentication is `npx vercel --prod` from that root. Account/project selection may be needed. No paid API keys are required for this MVP; leave `VITE_API_URL` unset so hosted API calls remain same-origin.

The actual public URL, Python cloud startup, routing, asset delivery, and endpoint availability must be verified after deployment. A localhost production build does not establish that these cloud checks pass. Do not disable deployment protections without the owner's approval if the chosen account requires authentication for previews.

Public serverless plans and survey notes are stored in the current browser only, with an explicit label. They are not shared between devices and can be lost when site data is cleared. No database or multi-user authentication was added. Do not use this demo to collect sensitive field records.

## Quest 2 acceptance checklist — not yet run

1. On the headset, use Meta Quest Browser with Wi-Fi. Open the deployed HTTPS URL directly; no laptop tether or Link is required. For the shortest demo path use `/?vr=1`.
2. Wait for geography/profile loading. The dashboard's Enter VR button opens preparation; the prepared view's Enter VR button requests the immersive session from that real click. Accept the browser's VR permission when you intend to start.
3. With controllers, verify both rays, zone selection, panel tabs and all 18 zones through previous/next. Inspect the smallest text at a comfortable distance.
4. Hold one grip to move the city. Hold both grips and spread/rotate the controllers to scale/rotate. Release either grip without jumps. Trigger-grab a coloured handle and lift each layer. Verify Reassemble and Home.
5. Enable headset hand tracking, set the controllers down and confirm tracked hands appear. Pinch a zone or panel via its ray. Pinch the cyan city handle with both hands and spread. Pinch/lift each coloured layer handle. Check temporary tracking loss and then pick up the controllers to confirm fallback recovery.
6. On Mount Road, choose Pocket Park. Expect projected cooling 3.20°C and total ₹2,14,50,000 with the current bundled model/default allowances. Verify greenery/heat appearance changes and Before/After resets the visual comparison. Try cool roofs and permeable paving as well.
7. Enable Flight. Test left-stick movement, right-stick turning/altitude and Home. Stop if smooth artificial motion is uncomfortable; use zone focus and tabletop manipulation instead.
8. Check sound/mute. Exit using the in-world button, enter again, then return to the ordinary dashboard without a blank canvas or continuing unwanted audio.
9. Check fresh weather timestamps online. Lose network after a reading and verify cached/unavailable labelling. The cached profile baseline must not be called live weather.
10. Run for at least five minutes, including maximum expansion and separated layers. Record headset/browser version, input mode, frame stability, thermal slowdown, battery impact, text comfort and any tracking failures. Desktop FPS is not evidence of Quest FPS.

Suggested judge sequence: enter → grab/expand → separate layers → select Mount Road → add Pocket Park and cool roof → compare → fly briefly → Home. Keep controllers nearby even if the primary presentation uses hands.

## Data and limitations

- The 18 zones are the **existing project's study areas**, not a claim that Chennai has 18 municipal administrative zones. Zone rectangles are not official boundaries.
- This is a mapped city abstraction, not a complete photogrammetric reconstruction. Buildings outside the sampled areas are absent. Unknown heights use 9 m; all displayed building heights are exaggerated 4× and capped for readability. Intervention placement is conceptual, not a selected real parcel.
- OSM geometry does not validate the older project statistics: building density, green cover, population and NDVI may be fallback/modelled values, labelled accordingly.
- Zone surface temperatures are morphology-model estimates anchored to a NASA POWER climatology baseline. They are not current satellite temperatures. Open-Meteo air weather is a separate coarse-grid current-weather product, not a per-zone ground sensor.
- Cooling values, literature/source labels and unit prices are inherited from the project; this task checked arithmetic, not the scientific applicability of every underlying study. Multiple interventions use 75% of summed cooling. Costs add 18% installation and 12% site work, then 10% contingency on that subtotal. These are planning assumptions, not approved engineering, financial advice or tendered quotes.
- OSM vectors and profile snapshot are bundled. Esri imagery and live weather still require internet. Geography failure leaves the remaining annotations usable. There is no service-worker offline installation.
- VR choices are retained while exploring the current scene, not across a page reload, and do not automatically overwrite a saved 2D plan.
- Physical hands/controllers, stereo rendering, tracking loss, session re-entry and Quest performance still require the checks above. No hardware test or public deployment is claimed.

Sources: [OpenStreetMap attribution/licence](https://www.openstreetmap.org/copyright), [Esri imagery service](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer), [Open-Meteo API](https://open-meteo.com/en/docs), [NASA POWER](https://power.larc.nasa.gov/), [WebXR session requirements](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/requestSession). The OSM snapshot contains its acquisition time and coverage note; `frontend/scripts/fetch-city.mjs` can reproduce acquisition. Existing Natural Earth boundary provenance remains under `frontend/public/geo`.

## Changed files and local evidence

New: `frontend/src/vr/{VRExperience.jsx,scene.js,city.js,panel.js,audio.js,model.js,model.test.js,vr.css}`; `frontend/public/vr/{chennai-osm.json,profiles.json}`; `frontend/scripts/fetch-city.mjs`; `backend/export_vr.py`; `backend/test_vr.py`; `api/index.py`; root `requirements.txt`, `vercel.json`, `.vercelignore`, `.gitignore`, and this guide.

Updated: `frontend/src/App.jsx`, `App.css`, `utils/api.js`, `components/Sidebar.jsx`, `screens/{SitePlanner,MobileSurvey,CostEstimate}.jsx`, `globe/GlobeLanding.jsx`, `package.json`, `package-lock.json`, `vite.config.js`; `backend/app/{main,planning}.py`.

Verified locally: production compilation; five frontend test cases covering all 18 locations, recommendation prices, all 144 intervention subsets, weather freshness and map clipping; backend bootstrap and 144-subset cost/cooling checks; all 18 browser zone selectors; desktop layer separation and intervention UI; ordinary 2D workspace/planner/cost/survey navigation; responsive inspection at 390 px. Lint has no errors and 12 pre-existing-style warnings in the older React screens. The build warns about large Cesium/Three chunks; those engines are loaded separately on demand. Vercel cloud and physical-headset checks remain pending.
