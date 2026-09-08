import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { project, clipSegment } from "./model";

const basic = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
    side: THREE.DoubleSide,
  });
const surface = (points, y, color, opacity) => {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return new THREE.Mesh(g, basic(color, opacity));
};
function segments(lines, y, color, parent) {
  const nw = project([13.14, 80.08]),
    se = project([12.88, 80.3]);
  const points = [];
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const cut = clipSegment(line[i - 1], line[i], [
        nw[0],
        nw[1],
        se[0],
        se[1],
      ]);
      if (cut) points.push(cut[0][0], y, cut[0][1], cut[1][0], y, cut[1][1]);
    }
  if (!points.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  parent.add(
    new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    ),
  );
}

export async function buildCity(zones, onProgress, signal) {
  const root = new THREE.Group(),
    base = new THREE.Group(),
    heat = new THREE.Group(),
    green = new THREE.Group(),
    density = new THREE.Group();
  root.add(base, density, green, heat);
  const layers = [heat, green, density];
  const disposables = [];
  const corners = [
    [12.88, 80.08],
    [13.14, 80.3],
  ].map(project);
  const width = corners[1][0] - corners[0][0],
    depth = corners[0][1] - corners[1][1];
  const cx = (corners[0][0] + corners[1][0]) / 2,
    cz = (corners[0][1] + corners[1][1]) / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.5, 0.2, depth + 0.5),
    new THREE.MeshStandardMaterial({
      color: "#09262f",
      roughness: 0.65,
      metalness: 0.45,
    }),
  );
  slab.position.set(cx, -0.13, cz);
  base.add(slab);
  slab.userData.grab = "city";
  const map = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    basic("#16414a"),
  );
  map.rotation.x = -Math.PI / 2;
  map.position.set(cx, 0, cz);
  base.add(map);
  // Public Esri imagery: one bounded image, not thousands of runtime tiles.
  const imagery =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=80.08,12.88,80.30,13.14&bboxSR=4326&imageSR=4326&size=1408,1664&format=jpg&f=image";
  let disposed = false;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(
    imagery,
    (t) => {
      if (disposed) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      map.material.map = t;
      map.material.color.set("#aec8c6");
      map.material.needsUpdate = true;
    },
    undefined,
    () => {},
  );
  let geo = null;
  onProgress("Loading Chennai geography…");
  try {
    const res = await fetch("/vr/chennai-osm.json", { signal });
    if (!res.ok) throw Error();
    geo = await res.json();
  } catch (e) {
    if (signal.aborted) throw e;
  }
  const buildingsByZone = new Map(zones.map((z) => [z.id, []]));
  const roads = [],
    water = [],
    coast = [],
    parks = [];
  if (geo) {
    let processed = 0;
    for (const f of geo.features) {
      if (++processed % 1000 === 0) {
        onProgress(
          `Building Chennai · ${Math.round((processed / geo.features.length) * 100)}%`,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) break;
      }
      const p = f.points.map(([lon, lat]) => project([lat, lon]));
      if (f.kind === "building") {
        if (p.length < 4) continue;
        const x = p.reduce((s, v) => s + v[0], 0) / p.length,
          z = p.reduce((s, v) => s + v[1], 0) / p.length;
        const nearest = zones.reduce((best, zone) => {
          const a = project(zone.center),
            b = project(best.center);
          return Math.hypot(a[0] - x, a[1] - z) < Math.hypot(b[0] - x, b[1] - z)
            ? zone
            : best;
        }, zones[0]);
        const shape = new THREE.Shape(
          p.map(([a, b]) => new THREE.Vector2(a, -b)),
        );
        const g = new THREE.ExtrudeGeometry(shape, {
          depth: Math.min(150, f.height || 9) * 0.004,
          bevelEnabled: false,
          steps: 1,
        });
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.035, 0);
        buildingsByZone.get(nearest.id).push(g);
      } else if (f.kind === "road") roads.push(p);
      else if (f.kind === "coast") coast.push(p);
      else if (f.kind === "water") water.push(p);
      else parks.push(p);
    }
  }
  segments(roads, 0.032, "#acd4ce", base);
  segments(water, 0.04, "#55ccf5", base);
  segments(coast, 0.04, "#79ecff", base);
  for (const p of parks)
    if (
      p.length > 3 &&
      p.every(
        ([x, z]) =>
          x >= corners[0][0] &&
          x <= corners[1][0] &&
          z >= corners[1][1] &&
          z <= corners[0][1],
      )
    )
      green.add(surface(p, 0.05, "#299d66", 0.48));
  const meshes = new Map(),
    markers = [],
    zoneHeat = new Map(),
    effects = new Map(),
    labels = [];
  zones.forEach((zone, index) => {
    const [x, z] = project(zone.center);
    const box = zone.bounds.map(project);
    const rect = [
      [box[0][0], box[0][1]],
      [box[1][0], box[0][1]],
      [box[1][0], box[1][1]],
      [box[0][0], box[1][1]],
    ];
    const h = surface(rect, 0.06, zone.heat_color, 0.3);
    heat.add(h);
    zoneHeat.set(zone.id, h);
    segments([[...rect, rect[0]]], 0.068, zone.heat_color, heat);
    const gs = buildingsByZone.get(zone.id);
    if (gs.length) {
      const merged = mergeGeometries(gs, false);
      // At a distant overview retain a deterministic subset of real buildings;
      // restore every mapped footprint as the city is expanded or approached.
      const coarse = mergeGeometries(
        gs.filter((_, i) => i % 4 === 0),
        false,
      );
      gs.forEach((g) => g.dispose());
      if (merged) {
        const m = new THREE.Mesh(
          merged,
          new THREE.MeshStandardMaterial({
            color: "#aac6c9",
            roughness: 0.68,
            metalness: 0.15,
          }),
        );
        merged.computeBoundingSphere();
        m.userData.full = merged;
        m.userData.coarse = coarse || merged;
        disposables.push(merged);
        if (coarse) disposables.push(coarse);
        density.add(m);
        meshes.set(zone.id, m);
      }
    }
    const greenDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.2 + zone.green_cover_pct / 55, 24),
      basic("#57df94", 0.24),
    );
    greenDisc.rotation.x = -Math.PI / 2;
    greenDisc.position.set(x, 0.095, z);
    green.add(greenDisc);
    // Markers are map annotations, not buildings or claimed measurements.
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.24, 0.16, 16),
      basic(zone.heat_color),
    );
    marker.position.set(x, 0.23, z);
    marker.userData.zoneId = zone.id;
    heat.add(marker);
    markers.push(marker);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    c.fillStyle = "#eafff8";
    c.font = "bold 72px sans-serif";
    c.textAlign = "center";
    c.fillText(String(index + 1).padStart(2, "0"), 64, 89);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false }),
    );
    label.position.set(x, 0.8, z);
    label.scale.set(0.65, 0.65, 1);
    label.renderOrder = 4;
    heat.add(label);
    labels.push(label);
    const fx = new THREE.Group();
    fx.position.set(x, 0.08, z);
    base.add(fx);
    effects.set(zone.id, fx);
    const treeG = new THREE.ConeGeometry(0.06, 0.25, 6),
      treeM = new THREE.MeshStandardMaterial({ color: "#69e89c" });
    const trees = new THREE.InstancedMesh(treeG, treeM, 48);
    const o = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const a = i * 2.39996,
        r = 0.5 * Math.sqrt(i / 48);
      o.position.set(Math.cos(a) * r, 0.15, Math.sin(a) * r);
      o.updateMatrix();
      trees.setMatrixAt(i, o.matrix);
    }
    trees.visible = false;
    trees.name = "green";
    fx.add(trees);
    for (const [name, color] of [
      ["cool_surface", "#c6eeef"],
      ["water", "#50c1f0"],
    ]) {
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.65, 8, 8),
        basic(color, 0.75),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(name === "water" ? -0.45 : 0.45, 0.025, 0);
      patch.visible = false;
      patch.name = name;
      fx.add(patch);
    }
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.46, 40),
    basic("#c9fff2"),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  heat.add(ring);
  onProgress(
    geo
      ? `${geo.features.filter((f) => f.kind === "building").length.toLocaleString()} mapped footprints loaded`
      : "Building footprints unavailable; map annotations remain usable",
  );
  const cameraPoint = new THREE.Vector3();
  return {
    root,
    base,
    layers,
    markers,
    labels,
    geo,
    ring,
    grabSurface: slab,
    updateLOD(camera) {
      camera.getWorldPosition(cameraPoint);
      density.worldToLocal(cameraPoint);
      for (const m of meshes.values()) {
        const distance = cameraPoint.distanceTo(
          m.userData.full.boundingSphere.center,
        );
        // Hysteresis avoids flickering at the boundary. Distances are map km.
        if (distance > 85) m.geometry = m.userData.coarse;
        else if (distance < 70) m.geometry = m.userData.full;
      }
    },
    select(id) {
      const zone = zones.find((z) => z.id === id);
      if (zone) {
        const [x, z] = project(zone.center);
        ring.position.set(x, 0.34, z);
        ring.visible = true;
      }
    },
    apply(id, selected, drop) {
      const group = effects.get(id);
      if (!group) return;
      group.children.forEach(
        (m) => (m.visible = selected.some((i) => i.category === m.name)),
      );
      const b = meshes.get(id);
      if (b)
        b.material.color.set(
          selected.some((i) => i.category === "cool_surface")
            ? "#e3ffff"
            : "#aac6c9",
        );
      const zone = zones.find((z) => z.id === id);
      zoneHeat
        .get(id)
        .material.color.copy(
          new THREE.Color(zone.heat_color).lerp(
            new THREE.Color("#3b82f6"),
            Math.min(0.9, drop / 4),
          ),
        );
    },
    dispose() {
      disposed = true;
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat().filter(Boolean)) {
          m.map?.dispose();
          m.dispose();
        }
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}
