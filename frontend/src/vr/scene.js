import { hasMappedData, currentWeather } from '../utils/dataStatus';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { buildCity } from "./city";
import { Panel } from "./panel";
import { impact, money, project, weatherStatus, TUTORIAL } from "./model";
import { createAudio } from "./audio";
import { fetchLiveClimate, fetchVRBootstrap } from "../utils/api";

const clamp = THREE.MathUtils.clamp;
export async function createExperience(
  container,
  zones,
  { signal, onProgress, onState, onError, onExit },
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#061119");
  scene.fog = new THREE.FogExp2("#061119", 0.016);
  const camera = new THREE.PerspectiveCamera(
    52,
    container.clientWidth / container.clientHeight,
    0.015,
    160,
  );
  camera.position.set(0, 2.6, 1.2);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.xr.enabled = true;
  renderer.xr.setFramebufferScaleFactor(1);
  renderer.xr.setFoveation(0.6);
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.95, -1.5);
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.enableDamping = true;
  controls.update();
  scene.add(new THREE.HemisphereLight("#c2f4ff", "#163237", 2.1));
  const sun = new THREE.DirectionalLight("#ffe3bf", 2.8);
  sun.position.set(-5, 12, 4);
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(45, 96),
    new THREE.MeshStandardMaterial({ color: "#081c24", roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  scene.add(floor);
  const grid = new THREE.GridHelper(80, 80, "#16404b", "#102c37");
  grid.position.y = -0.01;
  scene.add(grid);
  const audio = createAudio();
  let disposed = false,
    city,
    weatherTimer,
    resize,
    sessionStart = () => {},
    sessionEnd = () => {};
  try {
    city = await buildCity(zones, onProgress, signal);
  } catch (e) {
    renderer.dispose();
    renderer.domElement.remove();
    controls.dispose();
    throw e;
  }
  if (signal.aborted) {
    city.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    controls.dispose();
    throw new DOMException("Aborted", "AbortError");
  }
  city.root.position.set(-0.18, 0.85, -1.7);
  city.root.scale.setScalar(0.073);
  scene.add(city.root);
  const ui = new THREE.Group();
  ui.visible = false;
  rig.add(ui);
  const profile = new Panel(960, 1152, 0.82);
  profile.mesh.position.set(1.12, 1.55, -1.6);
  profile.mesh.rotation.y = -0.3;
  ui.add(profile.mesh);
  const bar = new Panel(1440, 480, 1.55);
  bar.mesh.position.set(-0.05, 0.52, -0.95);
  bar.mesh.rotation.x = -0.38;
  ui.add(bar.mesh);
  const help = new Panel(900, 460, 0.75);
  help.mesh.position.set(-1.2, 1.67, -1.45);
  help.mesh.rotation.y = 0.3;
  ui.add(help.mesh);
  const panels = [profile, bar, help];
  const handles = [];
  const handleMaterial = new THREE.MeshBasicMaterial({ color: "#54f4da" });
  const whole = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.12, 8, 40),
    handleMaterial,
  );
  whole.rotation.x = -Math.PI / 2;
  whole.position.set(0, 0.2, 13);
  whole.userData.grab = "city";
  city.root.add(whole);
  handles.push(whole);
  ["#ff9757", "#64eda0", "#87ddf5"].forEach((color, i) => {
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 16, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    handle.position.set(-12, 0.55, 8 - i * 4);
    handle.userData.grab = i;
    city.layers[i].add(handle);
    handles.push(handle);
  });
  const state = {
    zone: zones.find((z) => z.id === "mount_road") || zones[0],
    page: 0,
    step: 0,
    split: false,
    sound: false,
    flight: false,
    before: false,
    chosen: {},
    details: {},
    weather: {},
    source: "Loading profiles",
    geometry: city.geo
      ? `${city.geo.features.filter((f) => f.kind === "building").length.toLocaleString()} OSM footprints`
      : "Footprints unavailable",
    loading: true,
  };
  let weatherPending = false,
    weatherAttemptedAt = 0,
    weatherError = false,
    grabs = new Map(),
    pair = null,
    lastTime = 0,
    frameCount = 0,
    frameStart = 0;
  const raycaster = new THREE.Raycaster(),
    cursor = new THREE.Vector2();
  const hitTargets = () => [
    ...(renderer.xr.isPresenting ? panels.map((p) => p.mesh) : []),
    ...handles,
    ...city.markers,
    city.grabSurface,
  ];
  const chosen = () => state.chosen[state.zone.id] || [];
  const result = () =>
    impact(state.details[state.zone.id]?.interventions || [], chosen());
  function publish() {
    onState({
      ...state,
      chosenIds: chosen(),
      result: result(),
      detail: state.details[state.zone.id],
      reading: state.weather[state.zone.id],
    });
  }
  function draw() {
    const z = state.zone,
      d = state.details[z.id],
      r = result(),
      w = state.weather[z.id],
      ws = state.weatherError && w ? "Cached" : weatherStatus(w),
      p = profile;
    p.begin(
      z.name,
      "CHENNAI / " +
        String(zones.indexOf(z) + 1).padStart(2, "0") +
        " / " +
        zones.length +
        " ZONES",
    );
    ["Profile", "Diagnosis", "Interventions"].forEach((title, i) =>
      p.button(
        title,
        36 + i * 298,
        150,
        284,
        56,
        () => {
          state.page = i;
          draw();
          publish();
        },
        state.page === i,
      ),
    );
    if (state.page === 2 || !hasMappedData(z)) {
      p.wrap(state.page === 2
        ? "Costs and cooling benefits unavailable. Verified local rates and intervention evidence are not connected."
        : "Zone statistics unavailable. No recent verified morphology data; fallback temperature, risk and population are hidden.",
        36, 270, 864, 32, "#edc38b", 44, 6);
      p.text(currentWeather(w) ? w.air_temp_c + "°C · API air temperature" : "Current weather unavailable", 36, 630, 32, "#eafff7");
      p.wrap(w?.observed_at ? "Open-Meteo weather model · " + w.observed_at + " UTC" : "Source timestamp unavailable", 36, 700, 864, 24);
    } else if (state.page === 0) {
      p.text(`${z.lst_celsius.toFixed(1)}°C`, 36, 295, 72, "#ffa766");
      p.text(
        `Risk ${z.heat_risk_score} / 100 · ${z.risk_level}`,
        440,
        270,
        27,
        "#ffa766",
      );
      p.text("Modelled surface temperature", 36, 338, 23);
      p.text("Morphology heat-risk model", 440, 312, 22);
      p.text(
        `${ws} weather · ${Number.isFinite(w?.air_temp_c) ? w.air_temp_c + "°C" : "—"} air`,
        36,
        409,
        32,
        "#6de9d1",
      );
      p.text(
        Number.isFinite(w?.humidity_pct)
          ? `Humidity ${w.humidity_pct}% · feels ${w.apparent_temp_c}°C`
          : "Weather unavailable; no reading substituted",
        36,
        448,
        23,
      );
      p.text(
        w?.observed_at
          ? `Open-Meteo · ${w.observed_at.replace("T", " ")} UTC`
          : "Requesting current Open-Meteo weather",
        36,
        483,
        21,
      );
      [
        ["Building density", z.building_density_pct + "%"],
        ["Green cover", z.green_cover_pct + "%"],
        ["Road cover", z.road_coverage_pct + "%"],
        ["NDVI proxy", z.ndvi],
        [
          "Residents (estimated)",
          Math.round(z.estimated_population).toLocaleString("en-IN"),
        ],
        ["Water proximity", z.water_proximity_m + " m"],
        [
          "Government land",
          Math.round(z.govt_land_area_sqm).toLocaleString("en-IN") + " m²",
        ],
      ].forEach(([label, val], i) => {
        p.text(label, 36, 552 + i * 47, 26);
        p.text(val, 570, 552 + i * 47, 27, "#eafff7");
      });
      p.wrap(
        z.osm_fetched
          ? "Morphology: OSM-derived. Population and NDVI are estimates."
          : "Morphology: existing project estimates; OSM survey not verified. Population and NDVI are modelled.",
        36,
        920,
        864,
        23,
        "#edc38b",
        30,
        3,
      );
      p.text(state.source, 36, 1034, 21, "#83aab6");
    } else if (state.page === 1) {
      let y =
        p.wrap(
          d?.diagnosis?.primary_cause || z.description,
          36,
          258,
          864,
          29,
          "#edfff8",
          40,
          5,
        ) + 26;
      for (const factor of d?.diagnosis?.contributing_factors || []) {
        y = p.wrap("• " + factor, 36, y, 864, 25, "#a4c4c9", 34, 3) + 20;
      }
      y = p.wrap(z.description, 36, y + 8, 864, 24, "#a4c4c9", 34, 4);
      p.wrap(
        "Computed explanation from the project model. Surface heat and cooling effects are estimates, not live satellite pixels or a validated fluid-dynamics simulation.",
        36,
        835,
        864,
        23,
        "#edc38b",
        32,
        4,
      );
      p.wrap(
        "Map: © OpenStreetMap contributors (ODbL), Esri imagery. Building heights may be illustrative; project zone boxes are not administrative boundaries.",
        36,
        985,
        864,
        20,
        "#83aab6",
        28,
        3,
      );
    } else {
      p.text("Choose cooling interventions", 36, 258, 30, "#e3fff8");
      if (!d) p.wrap("Loading recommendations…", 36, 310);
      (d?.interventions || []).slice(0, 3).forEach((item, i) => {
        const y = 290 + i * 155;
        const active = chosen().includes(item.id);
        p.button(
          (active ? "✓ " : "+ ") + item.name,
          36,
          y,
          884,
          61,
          () => toggle(item.id),
          active,
        );
        p.text(
          `−${item.temp_drop}°C projected · ${money(item.estimated_cost_inr)}`,
          52,
          y + 94,
          25,
          "#ffb779",
        );
        p.text(
          `${item.authority} approval · ${item.effect_radius_m}m radius`,
          52,
          y + 128,
          22,
        );
      });
      p.text(
        `−${r.drop.toFixed(2)}°C projected cooling`,
        36,
        827,
        39,
        "#64efbd",
      );
      p.text(`${money(r.total)} including allowances`, 36, 879, 29, "#f1fff8");
      p.text("18% installation + 12% site work + 10% contingency", 36, 921, 21);
      p.wrap(
        "Combined cooling is damped to 75% when multiple measures overlap. Indicative costs; visuals show a concept, not approved placement.",
        36,
        962,
        864,
        22,
        "#edc38b",
        30,
        3,
      );
    }
    p.button("‹ Previous zone", 36, 1070, 277, 52, () =>
      select(zones[(zones.indexOf(z) + 17) % 18].id),
    );
    p.button("Next zone ›", 330, 1070, 277, 52, () =>
      select(zones[(zones.indexOf(z) + 1) % 18].id),
    );
    p.button("Fly to zone", 624, 1070, 296, 52, () => focusZone());
    p.finish();
    bar.begin(
      "CHENNAI / HOLOGRAM",
      "HEATSCAPE   •   " + state.geometry.toUpperCase(),
    );
    const actions = [
      ["Expand city", () => scale(1.35)],
      ["Separate layers", () => split()],
      ["Reassemble", () => reassemble()],
      ["Home", () => home()],
      ["Sound " + (state.sound ? "on" : "off"), () => sound()],
      ["Flight " + (state.flight ? "on" : "off"), () => flight()],
      ["Before / after", () => before()],
      ["Reset measures", () => resetMeasures()],
      ["Exit VR", () => exit()],
    ];
    actions.forEach(([label, fn], i) =>
      bar.button(
        label,
        36 + (i % 5) * 278,
        155 + Math.floor(i / 5) * 86,
        264,
        66,
        fn,
      ),
    );
    bar.text(
      "Grip: move / scale  •  Trigger or pinch: select  •  Left stick: fly  •  Right stick: turn / height",
      36,
      386,
      23,
    );
    bar.text(
      "Heat: modelled surface temperature  |  Green: coverage proxy  |  Buildings: mapped footprints",
      36,
      429,
      22,
    );
    bar.finish();
    const [title, text] = TUTORIAL[state.step];
    help.begin(title, `QUICK START / ${state.step + 1} OF ${TUTORIAL.length}`);
    help.wrap(text, 36, 185, 824, 27, "#c7e7e3", 38, 4);
    help.button("Next tip", 36, 366, 240, 58, () => {
      state.step = (state.step + 1) % TUTORIAL.length;
      draw();
      publish();
    });
    help.finish();
  }
  function select(id) {
    const z = zones.find((z) => z.id === id);
    if (!z) return;
    state.zone = z;
    city.select(id);
    state.before = false;
    apply();
    audio.ping();
    draw();
    publish();
    refreshWeather();
  }
  function apply() {
    const r = result();
    city.apply(
      state.zone.id,
      state.before ? [] : r.selected,
      state.before ? 0 : r.drop,
    );
  }
  function toggle(id) {
    if (!state.details[state.zone.id]?.interventions.some((i) => i.id === id))
      return;
    const set = new Set(chosen());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    state.chosen[state.zone.id] = [...set];
    state.before = false;
    apply();
    audio.ping();
    draw();
    publish();
  }
  function before() {
    state.before = !state.before;
    apply();
    draw();
    publish();
  }
  function resetMeasures() {
    state.chosen[state.zone.id] = [];
    state.before = false;
    apply();
    draw();
    publish();
  }
  function scale(factor) {
    city.root.scale.setScalar(clamp(city.root.scale.x * factor, 0.035, 0.45));
    audio.ping();
  }
  function split() {
    state.split = true;
    city.layers.forEach((l, i) => (l.userData.targetY = 2.4 * (3 - i)));
    draw();
    publish();
    audio.ping();
  }
  function reassemble() {
    state.split = false;
    city.layers.forEach((l) => (l.userData.targetY = 0));
    draw();
    publish();
  }
  function home() {
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    city.root.position.set(-0.18, 0.85, -1.7);
    city.root.rotation.set(0, 0, 0);
    city.root.scale.setScalar(0.073);
    state.flight = false;
    grabs.clear();
    pair = null;
    if (!renderer.xr.isPresenting) {
      camera.position.set(0, 2.6, 1.2);
      controls.target.set(0, 0.95, -1.5);
      controls.update();
    }
    draw();
    publish();
  }
  function focusZone() {
    const [x, z] = project(state.zone.center);
    const dest = city.root.localToWorld(new THREE.Vector3(x, 0, z));
    if (renderer.xr.isPresenting) {
      rig.position.set(dest.x, Math.max(0, dest.y - 0.8), dest.z + 0.65);
      state.flight = true;
    } else {
      controls.target.copy(dest);
      camera.position.copy(dest).add(new THREE.Vector3(0, 0.65, 1.1));
      controls.update();
    }
    draw();
    publish();
  }
  function flight() {
    state.flight = !state.flight;
    draw();
    publish();
  }
  function sound() {
    state.sound = audio.toggle();
    draw();
    publish();
  }
  function exit() {
    const session = renderer.xr.getSession();
    if (session) session.end().catch((e) => onError(e.message));
    else onExit();
  }
  async function refreshWeather() {
    // One response covers every zone. Do not refetch when judges browse quickly.
    if (weatherPending || disposed || Date.now() - weatherAttemptedAt < 60000)
      return;
    weatherAttemptedAt = Date.now();
    weatherPending = true;
    try {
      const response = await fetchLiveClimate();
      if (disposed) return;
      for (const reading of response.readings || [])
        if (Number.isFinite(reading.air_temp_c))
          state.weather[reading.zone_id] = reading;
      weatherError = !response.readings?.length;
      if (!weatherError)
        try {
          localStorage.setItem(
            "heatscape-vr-weather",
            JSON.stringify(state.weather),
          );
        } catch {}
    } catch {
      weatherError = true;
    } finally {
      weatherPending = false;
      if (!disposed) {
        state.weatherError = weatherError;
        draw();
        publish();
      }
    }
  }
  try {
    state.weather = JSON.parse(
      localStorage.getItem("heatscape-vr-weather") || "{}",
    );
  } catch {}
  draw();
  city.select(state.zone.id);
  publish();
  let data;
  try {
    data = await fetchVRBootstrap(signal);
    state.source = "API profiles";
  } catch (e) {
    if (signal.aborted) {
      dispose();
      throw e;
    }
    try {
      const res = await fetch("/vr/profiles.json", { signal });
      if (!res.ok) throw Error();
      data = await res.json();
      state.source = `Bundled model snapshot · ${data.generated_at?.slice(0, 10)}`;
    } catch {
      state.source = "Profiles unavailable";
    }
  }
  if (disposed || signal.aborted) {
    dispose();
    throw new DOMException("Aborted", "AbortError");
  }
  if (data?.profiles) state.details = data.profiles;
  state.loading = false;
  draw();
  publish();
  refreshWeather();
  weatherTimer = setInterval(refreshWeather, 5 * 60 * 1000);
  const inputs = [];
  const factory = new XRHandModelFactory();
  function inputPosition(input) {
    const joint = input.hand.joints?.["index-finger-tip"];
    return input.source?.hand && input.hand.visible && joint
      ? joint.getWorldPosition(new THREE.Vector3())
      : input.grip.getWorldPosition(new THREE.Vector3());
  }
  function beginGrab(input, kind) {
    const point = inputPosition(input);
    grabs.set(input, {
      kind,
      start: point,
      root: city.root.position.clone(),
      layer: typeof kind === "number" ? city.layers[kind].position.y : 0,
    });
    pair = null;
  }
  function release(input) {
    grabs.delete(input);
    pair = null;
    for (const [i, g] of grabs) {
      g.start = inputPosition(i);
      g.root = city.root.position.clone();
      g.layer = typeof g.kind === "number" ? city.layers[g.kind].position.y : 0;
    }
  }
  function rayInput(input) {
    const origin = input.controller.getWorldPosition(new THREE.Vector3()),
      q = input.controller.getWorldQuaternion(new THREE.Quaternion());
    raycaster.set(origin, new THREE.Vector3(0, 0, -1).applyQuaternion(q));
    return raycaster.intersectObjects(hitTargets(), false)[0];
  }
  function activate(hit, input) {
    if (!hit) return;
    if (hit.object.userData.panel) {
      hit.object.userData.panel.hit(hit.uv)?.();
      audio.ping();
    } else if (hit.object.userData.zoneId) select(hit.object.userData.zoneId);
    else if (input && hit.object.userData.grab !== undefined)
      beginGrab(input, hit.object.userData.grab);
  }
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i),
      grip = renderer.xr.getControllerGrip(i),
      hand = renderer.xr.getHand(i);
    rig.add(controller, grip, hand);
    hand.add(factory.createHandModel(hand, "spheres"));
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.018, 0.07, 4, 8),
      new THREE.MeshStandardMaterial({ color: "#91c9ce" }),
    );
    body.rotation.x = Math.PI / 2;
    grip.add(body);
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
      ]),
      new THREE.LineBasicMaterial({
        color: "#58eed0",
        transparent: true,
        opacity: 0.8,
      }),
    );
    beam.scale.z = 4;
    controller.add(beam);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 8, 8),
      new THREE.MeshBasicMaterial({ color: "#d7fff5", depthTest: false }),
    );
    scene.add(tip);
    const input = {
      controller,
      grip,
      hand,
      beam,
      tip,
      source: null,
      selecting: false,
      pinched: false,
    };
    inputs.push(input);
    controller.addEventListener("connected", (e) => {
      input.source = e.data;
      body.visible = !e.data.hand;
    });
    controller.addEventListener("disconnected", () => {
      release(input);
      input.source = null;
      input.selecting = false;
      tip.visible = false;
    });
    controller.addEventListener("squeezestart", () => {
      if (!input.source?.hand) beginGrab(input, "city");
    });
    controller.addEventListener("squeezeend", () => release(input));
    controller.addEventListener("selectstart", () => {
      input.selecting = true;
      let near = null;
      if (input.source?.hand) {
        const p = inputPosition(input);
        near = handles.find(
          (h) => h.getWorldPosition(new THREE.Vector3()).distanceTo(p) < 0.14,
        );
      }
      if (near) beginGrab(input, near.userData.grab);
      else activate(rayInput(input), input);
    });
    controller.addEventListener("selectend", () => {
      input.selecting = false;
      release(input);
    });
  }
  function gestures() {
    for (const input of inputs) {
      if (!input.source) continue;
      const hit = rayInput(input);
      input.beam.scale.z = hit ? Math.min(hit.distance, 8) : 4;
      input.tip.visible = !!hit;
      if (hit) input.tip.position.copy(hit.point);
      if (input.source.hand && !input.hand.visible) release(input);
    }
    const cityGrabs = [...grabs].filter(([, g]) => g.kind === "city");
    if (cityGrabs.length === 2) {
      const a = inputPosition(cityGrabs[0][0]),
        b = inputPosition(cityGrabs[1][0]);
      const middle = a.clone().add(b).multiplyScalar(0.5),
        distance = Math.max(0.04, a.distanceTo(b)),
        angle = Math.atan2(b.z - a.z, b.x - a.x);
      if (!pair)
        pair = {
          middle: middle.clone(),
          distance,
          angle,
          scale: city.root.scale.x,
          rotation: city.root.rotation.y,
          position: city.root.position.clone(),
        };
      const next = clamp((pair.scale * distance) / pair.distance, 0.035, 0.45),
        ratio = next / pair.scale,
        delta = angle - pair.angle;
      city.root.scale.setScalar(next);
      city.root.rotation.y = pair.rotation - delta;
      const offset = pair.position
        .clone()
        .sub(pair.middle)
        .multiplyScalar(ratio)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -delta);
      city.root.position.copy(middle).add(offset);
    } else
      for (const [input, g] of grabs) {
        const p = inputPosition(input);
        if (g.kind === "city")
          city.root.position.copy(g.root).add(p.sub(g.start));
        else {
          const layer = city.layers[g.kind];
          layer.userData.targetY = clamp(
            g.layer + (p.y - g.start.y) / city.root.scale.x,
            0,
            14,
          );
          state.split = true;
        }
      }
    city.root.position.y = clamp(city.root.position.y, 0.3, 3);
    city.root.position.x = clamp(city.root.position.x, -20, 20);
    city.root.position.z = clamp(city.root.position.z, -25, 10);
  }
  function fly(dt) {
    if (!state.flight) return;
    for (const input of inputs) {
      const gp = input.source?.gamepad;
      if (!gp) continue;
      const axes = gp.axes,
        dx = Math.abs(axes[2] || 0) > 0.15 ? axes[2] : 0,
        dy = Math.abs(axes[3] || 0) > 0.15 ? axes[3] : 0;
      if (input.source.handedness === "left") {
        const q = renderer.xr
          .getCamera()
          .getWorldQuaternion(new THREE.Quaternion());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        right.y = 0;
        right.normalize();
        rig.position
          .addScaledVector(forward, -dy * dt * 1.2)
          .addScaledVector(right, dx * dt * 1.2);
      } else if (input.source.handedness === "right") {
        rig.rotation.y -= dx * dt * 0.8;
        rig.position.y = clamp(rig.position.y - dy * dt * 0.8, -0.5, 12);
      }
      rig.position.x = clamp(rig.position.x, -18, 18);
      rig.position.z = clamp(rig.position.z, -22, 18);
    }
  }
  let pointerStart = null;
  function down(e) {
    pointerStart = { x: e.clientX, y: e.clientY };
  }
  function up(e) {
    if (
      renderer.xr.isPresenting ||
      !pointerStart ||
      Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 6
    )
      return;
    const r = renderer.domElement.getBoundingClientRect();
    cursor.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(cursor, camera);
    activate(raycaster.intersectObjects(hitTargets(), false)[0]);
    pointerStart = null;
  }
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  resize = new ResizeObserver(() => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  resize.observe(container);
  sessionStart = () => {
    controls.enabled = false;
    ui.visible = true;
    home();
    state.sound = true;
    audio.enable();
    state.immersive = true;
    draw();
    publish();
  };
  sessionEnd = () => {
    controls.enabled = true;
    ui.visible = false;
    state.immersive = false;
    home();
    publish();
  };
  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", sessionEnd);
  renderer.setAnimationLoop((time) => {
    if (disposed) return;
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0.016);
    lastTime = time;
    city.layers.forEach(
      (l) =>
        (l.position.y = THREE.MathUtils.damp(
          l.position.y,
          l.userData.targetY || 0,
          6,
          dt,
        )),
    );
    city.ring.rotation.z += dt * 0.5;
    if (renderer.xr.isPresenting) {
      gestures();
      fly(dt);
    } else controls.update();
    city.updateLOD(renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
    renderer.render(scene, camera);
    frameCount++;
    if (time - frameStart > 2000) {
      state.fps = Math.round((frameCount * 1000) / (time - frameStart));
      state.drawCalls = renderer.info.render.calls;
      state.triangles = renderer.info.render.triangles;
      publish();
      frameCount = 0;
      frameStart = time;
    }
  });
  async function enterVR() {
    if (disposed) return;
    // requestSession is invoked before any await, directly from the button handler.
    const pending = navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    });
    // Unlock audio while the initiating click still has user activation.
    audio.enable();
    const session = await pending;
    try {
      if (disposed) {
        await session.end();
        return;
      }
      await renderer.xr.setSession(session);
    } catch (e) {
      await session.end();
      throw e;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    if (typeof weatherTimer !== "undefined") clearInterval(weatherTimer);
    resize?.disconnect();
    controls.dispose();
    audio.dispose();
    const session = renderer.xr.getSession();
    session?.end().catch(() => {});
    renderer.xr.removeEventListener("sessionstart", sessionStart);
    renderer.xr.removeEventListener("sessionend", sessionEnd);
    renderer.domElement.removeEventListener("pointerdown", down);
    renderer.domElement.removeEventListener("pointerup", up);
    panels.forEach((p) => p.dispose());
    city.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
  }
  return {
    enterVR,
    dispose,
    select,
    toggle,
    before,
    resetMeasures,
    scale,
    split,
    reassemble,
    home,
    focusZone,
    flight,
    sound,
    nextTip() {
      state.step = (state.step + 1) % 4;
      draw();
      publish();
    },
    page(page) {
      state.page = page;
      draw();
      publish();
    },
  };
}
