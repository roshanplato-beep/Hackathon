import * as THREE from "three";

// One texture per in-world panel. Hit regions share the same pixel coordinates
// as drawing, so hands, controllers, and desktop clicks activate identical UI.
export class Panel {
  constructor(width = 960, height = 1152, worldWidth = 0.8) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldWidth, (worldWidth * height) / width),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.mesh.renderOrder = 50;
    this.mesh.userData.panel = this;
    this.regions = [];
  }
  begin(title, kicker = "HEATSCAPE / CHENNAI") {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height;
    this.regions = [];
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(5,20,28,0.97)";
    c.beginPath();
    c.roundRect(1, 1, w - 2, h - 2, 24);
    c.fill();
    c.strokeStyle = "#28616a";
    c.lineWidth = 2;
    c.stroke();
    this.text(kicker, 36, 50, 22, "#56e0c2");
    this.text(title, 36, 104, 36, "#f0faf7");
    c.fillStyle = "#1a4349";
    c.fillRect(36, 128, w - 72, 2);
  }
  text(text, x, y, size = 25, color = "#c1d7dc") {
    const c = this.ctx;
    c.font = `500 ${size}px system-ui, sans-serif`;
    c.fillStyle = color;
    c.textAlign = "left";
    c.fillText(String(text), x, y);
  }
  wrap(
    text,
    x,
    y,
    maxWidth = 864,
    size = 24,
    color = "#a7c4cb",
    line = 33,
    maxLines = 5,
  ) {
    const c = this.ctx;
    c.font = `500 ${size}px system-ui, sans-serif`;
    let row = "",
      n = 0;
    for (const word of String(text).split(/\s+/)) {
      if (c.measureText(row + word).width > maxWidth && row) {
        this.text(row, x, y + n * line, size, color);
        if (++n >= maxLines) {
          return y + n * line;
        }
        row = "";
      }
      row += word + " ";
    }
    if (row) this.text(row, x, y + n++ * line, size, color);
    return y + n * line;
  }
  button(label, x, y, w, h, action, active = false) {
    const c = this.ctx;
    c.fillStyle = active ? "#12675f" : "#13333e";
    c.strokeStyle = active ? "#65f5cb" : "#32616b";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, w, h, 10);
    c.fill();
    c.stroke();
    this.text(label, x + 18, y + h / 2 + 9, 25, active ? "#baffdf" : "#d0e8ed");
    this.regions.push({ x, y, w, h, action });
  }
  finish() {
    this.texture.needsUpdate = true;
  }
  hit(uv) {
    if (!uv) return null;
    const x = uv.x * this.canvas.width,
      y = (1 - uv.y) * this.canvas.height;
    return this.regions.find(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    )?.action;
  }
  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
