// Parametric keyring case for the Waveshare ESP32-S3-Touch-LCD-1.28.
// Shared by the browser viewer (index.html) and the STL exporter (scripts/export-stl.mjs).
//
// Axes: z = 0 is the back face of the case, +z points toward the display.
//       +y points to the keyring loop, -y to the USB-C port.
// Units: mm.

export const DEFAULTS = {
  // Board (Waveshare outline drawing)
  lcdD: 38.51,        // LCD module diameter
  lcdT: 3.0,          // LCD module thickness (measure!)
  windowD: 34.4,      // visible opening (VA is 33.4)
  pcbR: 18.75,        // PCB radius
  pcbT: 1.0,          // PCB thickness
  tabW: 25.28,        // width of the PCB tab that carries USB-C
  tabBottom: 20.74,   // tab bottom edge, measured from the board centre
  usbW: 8.94,         // USB-C receptacle
  usbH: 3.26,
  compH: 4.0,         // clearance for parts on the PCB back (USB-C, MX1.25)

  // Battery (measure yours)
  batW: 23,
  batL: 25,
  batT: 6,

  // Case
  clr: 0.25,          // fit clearance per side
  wallR: 25,          // outer radius (Ø50)
  lip: 1.2,           // front lip over the LCD edge
  floor: 1.6,         // back wall
  ringInner: 17.9,    // inner radius of the ring that presses on the PCB back
  ringH: 1.0,
  chamferFront: 1.2,
  chamferBack: 0.6,

  // USB-C plug opening (fits most cable overmolds)
  plugW: 12.4,
  plugH: 7.0,

  // Screws: M2 x 12, from the back, self-tapping into the front bezel
  screwR: 21.7,
  screwAngles: [90, 210, 330],
  screwLen: 12,
  clearD: 2.3,
  pilotD: 1.7,
  headD: 4.2,

  // Keyring loop
  lugHoleD: 4.0,
  lugT: 5.0,

  seg: 128,
};

export function layout(p) {
  const zBat = p.floor;
  const zComp = zBat + p.batT + 0.5;
  const zSplit = zComp + p.compH;        // PCB back face, also the split plane
  const zLcd = zSplit + p.pcbT;
  const zLip = zLcd + p.lcdT;
  const H = zLip + p.lip;
  const screwTip = H - 1.2;              // leaves 1.2 mm of solid lip above the screw
  const seat = screwTip - p.screwLen;    // depth of the head counterbore
  const zUsb = zSplit - p.usbH / 2;      // receptacle centre (mounted on PCB back)
  return { zBat, zComp, zSplit, zLcd, zLip, H, screwTip, seat, zUsb };
}

export function buildCase(wasm, userParams = {}) {
  const p = { ...DEFAULTS, ...userParams };
  const L = layout(p);
  const { Manifold, CrossSection } = wasm;
  const seg = p.seg;
  const R = p.wallR;
  const trash = [];
  const k = (m) => (trash.push(m), m);

  const roundedRect = (w, h, r) => k(
    k(CrossSection.square([w - 2 * r, h - 2 * r], true)).offset(r, 'Round', 2, 32));
  const prism = (cs, z0, z1) => k(k(Manifold.extrude(cs, z1 - z0)).translate([0, 0, z0]));
  const cyl = (d, z0, z1, x = 0, y = 0) =>
    k(k(Manifold.cylinder(z1 - z0, d / 2, d / 2, 48)).translate([x, y, z0]));

  // Board footprint, inflated by the fit clearance
  const tabBot = p.tabBottom + p.clr, tabTop = -5;
  const tab = k(roundedRect(p.tabW + 2 * p.clr, tabBot + tabTop, 2).translate([0, -(tabBot - tabTop) / 2]));
  const lcdCircle = k(CrossSection.circle(p.lcdD / 2 + p.clr, seg));
  const pocket = k(lcdCircle.add(tab));

  // Outer body: revolved profile with chamfered edges
  const profile = k(CrossSection.ofPolygons([[
    [0, 0], [R - p.chamferBack, 0], [R, p.chamferBack],
    [R, L.H - p.chamferFront], [R - p.chamferFront, L.H], [0, L.H],
  ]]));
  let body = k(Manifold.revolve(profile, seg));

  // Keyring lug, chamfered by hulling two slightly different extrusions
  const lugY = R + 4;
  const lugShape = k(CrossSection.hull([
    k(CrossSection.circle(4.8, 64).translate([0, lugY])),
    k(CrossSection.square([12, 2], true).translate([0, R - 3])),
  ]));
  const lugZ0 = 0;                       // sits on the print bed, no supports
  const lugC = 0.6;
  const lug = k(Manifold.hull([
    prism(k(lugShape.offset(-lugC, 'Round', 2, 32)), lugZ0, lugZ0 + p.lugT),
    prism(lugShape, lugZ0 + lugC, lugZ0 + p.lugT - lugC),
  ]));
  body = k(body.add(lug));

  const cuts = [];
  // Display window with a 45° viewing chamfer
  cuts.push(k(k(Manifold.cylinder(p.lip + 0.02, p.windowD / 2, p.windowD / 2 + p.lip, seg)).translate([0, 0, L.zLip - 0.01])));
  // LCD + PCB pocket
  cuts.push(prism(pocket, L.zSplit, L.zLip));
  // Component space behind the PCB
  cuts.push(prism(pocket, L.zComp, L.zSplit - p.ringH));
  // Support ring (cavity is smaller at the top, so the ring presses on the PCB edge)
  const ringOpen = k(CrossSection.union([
    k(CrossSection.circle(p.ringInner, seg)),
    tab,
    k(CrossSection.square([7, 9], true).translate([p.pcbR - 1, 0])), // battery wire notch at the MX1.25
  ]));
  cuts.push(prism(ringOpen, L.zSplit - p.ringH - 0.01, L.zSplit + 0.01));
  // 45° chamfer under the ring so it prints without supports
  const rOut = p.lcdD / 2 + p.clr, ch = rOut - p.ringInner;
  cuts.push(k(k(Manifold.cylinder(ch, rOut, p.ringInner, seg)).translate([0, 0, L.zSplit - p.ringH - ch])));
  // Battery bay
  cuts.push(prism(roundedRect(p.batW + 0.6, p.batL + 0.6, 1), L.zBat, L.zComp + 0.01));
  // USB-C plug opening, through the wall at -y
  const plug = k(k(Manifold.extrude(roundedRect(p.plugW, p.plugH, 1.6), R)).rotate([90, 0, 0]));
  cuts.push(k(plug.translate([0, -(p.tabBottom - 1), L.zUsb])));
  // Keyring hole, countersunk 0.5 mm on both sides
  const hr = p.lugHoleD / 2;
  cuts.push(cyl(p.lugHoleD, lugZ0 - 1, lugZ0 + p.lugT + 1, 0, lugY));
  cuts.push(k(k(Manifold.cylinder(1.01, hr + 1, hr, 48)).translate([0, lugY, lugZ0 - 0.5])));
  cuts.push(k(k(Manifold.cylinder(1.01, hr, hr + 1, 48)).translate([0, lugY, lugZ0 + p.lugT - 0.5])));
  // Screws
  for (const a of p.screwAngles) {
    const x = p.screwR * Math.cos(a * Math.PI / 180);
    const y = p.screwR * Math.sin(a * Math.PI / 180);
    cuts.push(cyl(p.headD, -1, L.seat, x, y));
    cuts.push(cyl(p.clearD, -1, L.zSplit + 0.01, x, y));
    cuts.push(cyl(p.pilotD, L.zSplit, L.screwTip + 0.3, x, y));
  }

  const shell = k(body.subtract(k(Manifold.union(cuts))));
  const back = shell.trimByPlane([0, 0, -1], -L.zSplit);
  const front = shell.trimByPlane([0, 0, 1], L.zSplit);

  trash.forEach((m) => m.delete());
  return { front, back, params: p, layout: L };
}

// Binary STL from a Manifold
export function toSTL(manifold) {
  const mesh = manifold.getMesh();
  const { vertProperties: v, triVerts: t, numProp: n } = mesh;
  const tris = t.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const header = 'seesun keyring case';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris, true);
  let o = 84;
  for (let i = 0; i < tris; i++) {
    const a = t[3 * i] * n, b = t[3 * i + 1] * n, c = t[3 * i + 2] * n;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const f of [nx / len, ny / len, nz / len]) { dv.setFloat32(o, f, true); o += 4; }
    for (const idx of [a, b, c]) {
      dv.setFloat32(o, v[idx], true); dv.setFloat32(o + 4, v[idx + 1], true); dv.setFloat32(o + 8, v[idx + 2], true);
      o += 12;
    }
    o += 2;
  }
  return buf;
}
