/* =====================================================================
   PLC_SCADA_HMI — 3D control scene
   Procedural three.js scene derived from the TiaLink project inventory.
   ===================================================================== */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------------ state
  const S = {
    running: false,
    mode: 'AUTO',
    estop: false,
    sims: { cv: false, rb101: false, rb102: false, fn: false },
    jog: { cv: false, fn: false, rb101: false, rb102: false },
    screen: 0,
    painted: 0,
    delivered: 0,
    alarms: 0,
    belt: 0,
    fan: 0,
    sprayOn: false,
    pid: { sp: 62, pv: 34, kp: 1.2, ki: 0.08, kd: 0.02, out: 41 },
    boot: performance.now(),
  };
  const pidHistory = new Array(96).fill(34);

  // ------------------------------------------------------------------ renderer
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070c12);
  scene.fog = new THREE.FogExp2(0x070c12, 0.013);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 220);

  // procedural environment (equirect gradient) — no external HDR needed
  (() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, '#1b3348');
    g.addColorStop(0.38, '#0b1822');
    g.addColorStop(0.52, '#060c12');
    g.addColorStop(1.00, '#020405');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    // soft overhead light bands
    x.fillStyle = 'rgba(150,205,255,0.10)';
    x.fillRect(60, 34, 150, 26);
    x.fillRect(300, 22, 120, 20);
    x.fillStyle = 'rgba(255,180,90,0.10)';
    x.fillRect(390, 96, 90, 16);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.encoding = THREE.sRGBEncoding;
    scene.environment = t;
  })();

  // ------------------------------------------------------------------ materials
  const std = (color, opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.25 }, opts));
  const M = {
    floor: std(0x070c11, { roughness: 1.0, metalness: 0.0, envMapIntensity: 0.04 }),
    steel: std(0x8b99a8, { metalness: 0.8, roughness: 0.3 }),
    steelDark: std(0x39434e, { metalness: 0.65, roughness: 0.42 }),
    steelSoft: std(0x6c7a88, { metalness: 0.55, roughness: 0.45 }),
    rubber: std(0x1d2227, { roughness: 0.95, metalness: 0.02 }),
    yellow: std(0xe8b02c, { metalness: 0.25, roughness: 0.5 }),
    blue: std(0x1f6db5, { metalness: 0.45, roughness: 0.4 }),
    blueLight: std(0x2e8fd6, { metalness: 0.35, roughness: 0.4 }),
    cabinet: std(0x4b5661, { metalness: 0.55, roughness: 0.5 }),
    cabinetDark: std(0x232b33, { metalness: 0.5, roughness: 0.55 }),
    black: std(0x11161b, { roughness: 0.7, metalness: 0.3 }),
    white: std(0xd9e4ee, { roughness: 0.6, metalness: 0.1 }),
    red: std(0xcf3b3b, { roughness: 0.4, metalness: 0.2 }),
    redDark: std(0x6e1d1d, { roughness: 0.6, metalness: 0.2 }),
    green: std(0x2fbf71, { roughness: 0.4, metalness: 0.2 }),
    amber: std(0xf0a63a, { roughness: 0.4, metalness: 0.2 }),
    wood: std(0x9a734a, { roughness: 0.9, metalness: 0.02 }),
    woodDark: std(0x6b4f33, { roughness: 0.9, metalness: 0.02 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d2233, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.55 }),
  };
  const RAW_COLOR = new THREE.Color(0x97a3ae);
  const PAINT_COLORS = [0xf03a1e, 0x1e7bff, 0xffc21e, 0x2ecc6f, 0x9b4dff];
  const SENSOR_X = [-4.8, -1.6, 1.4, 4.4];

  // ------------------------------------------------------------------ helpers
  function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0, parent = scene) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function makeLabel(text, opts = {}) {
    const height = opts.height || 0.3;
    const color = opts.color || '#d7e6f3';
    const accent = opts.accent || '#35c2ff';
    const fs = 52;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    c.width = Math.max(220, tw + 100);
    c.height = 104;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
    g.textBaseline = 'middle';
    roundRect(g, 3, 8, c.width - 6, c.height - 16, 18);
    g.fillStyle = 'rgba(5,11,17,0.82)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(120,190,235,0.28)';
    g.stroke();
    g.fillStyle = accent;
    roundRect(g, 18, c.height / 2 - 4, 7, 8, 3);
    g.fill();
    g.fillStyle = color;
    g.fillText(text, 40, c.height / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(height * c.width / c.height, height, 1);
    return s;
  }
  function addLabel(text, x, y, z, opts) {
    const s = makeLabel(text, opts);
    s.position.set(x, y, z);
    scene.add(s);
    return s;
  }

  // ------------------------------------------------------------------ floor / shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(80, 80, 0x254156, 0x142330);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  // safety stripe texture
  const stripeTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#101418'; x.fillRect(0, 0, 128, 64);
    x.strokeStyle = '#d8a82a'; x.lineWidth = 14;
    for (let i = -80; i < 200; i += 40) {
      x.beginPath(); x.moveTo(i, 70); x.lineTo(i + 70, -6); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(18, 1);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.85, metalness: 0.05 });
  [-2.35, 2.35].forEach((z) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 0.2), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(-1.0, 0.018, z);
    s.receiveShadow = true;
    scene.add(s);
  });

  // floor decal
  (() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 1024, 256);
    x.font = '700 104px "Segoe UI", system-ui, sans-serif';
    x.fillStyle = 'rgba(110,175,215,0.16)';
    x.textAlign = 'center';
    x.fillText('LINE 01  ·  PLC_SCADA_HMI', 512, 150);
    x.font = '600 30px "Segoe UI", system-ui, sans-serif';
    x.fillStyle = 'rgba(110,175,215,0.12)';
    x.fillText('S7-1500  /  ET 200SP  /  WINCC', 512, 205);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(-0.5, 0.016, 5.3);
    scene.add(m);
  })();

  // back wall
  const wall = box(46, 9, 0.5, std(0x080f16, { roughness: 0.92, metalness: 0.05 }), 0, 4.5, -11.5);
  wall.castShadow = false;
  for (let x = -20; x <= 20; x += 4) {
    const seam = box(0.08, 9, 0.56, std(0x080e14, { roughness: 0.9 }), x, 4.5, -11.24);
    seam.castShadow = false;
  }
  const wallStrip = box(42, 0.06, 0.08, new THREE.MeshStandardMaterial({ color: 0x143848, emissive: 0x35c2ff, emissiveIntensity: 1.6 }), 0, 5.6, -11.2);
  wallStrip.castShadow = false;
  box(42, 0.12, 0.1, std(0x1b2a36), 0, 0.06, -11.2).castShadow = false;

  // pendant light fixtures
  [-7.5, -1, 5.5].forEach((x) => {
    box(2.6, 0.1, 0.3, M.steelDark, x, 7.0, -1.2).castShadow = false;
    const glow = box(2.45, 0.025, 0.22, new THREE.MeshStandardMaterial({ color: 0xdfefff, emissive: 0xbfe4ff, emissiveIntensity: 1.35 }), x, 6.94, -1.2);
    glow.castShadow = false;
    box(0.018, 2.0, 0.018, M.steelDark, x - 0.9, 8.0, -1.2).castShadow = false;
    box(0.018, 2.0, 0.018, M.steelDark, x + 0.9, 8.0, -1.2).castShadow = false;
  });

  // cable tray on floor
  (() => {
    const tray = box(0.34, 0.07, 10.5, M.steelDark, -11.9, 0.05, -4.2);
    tray.rotation.y = 0.4;
    for (let i = 0; i < 8; i++) {
      const cable = cyl(0.035, 0.035, 10.2, 6, M.black, -11.95 + i * 0.045, 0.105, -4.25);
      cable.rotation.x = Math.PI / 2;
      cable.rotation.z = 0.4;
    }
  })();

  // simple crates
  [[9.8, -4.6, 1.3], [10.7, -5.0, 1.0], [9.9, -5.6, 0.9]].forEach(([x, z, s], i) => {
    const crate = box(s, s * 0.8, s, i === 1 ? M.woodDark : M.wood, x, s * 0.4, z);
    crate.rotation.y = i * 0.22;
    const band = box(s * 1.02, 0.05, s * 1.02, M.black, x, s * 0.55, z);
    band.rotation.y = crate.rotation.y;
  });

  // ------------------------------------------------------------------ conveyor
  const beltTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#242a30'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 16) {
      x.fillStyle = '#2e363d'; x.fillRect(0, i, 128, 3);
      x.fillStyle = '#161b20'; x.fillRect(0, i + 9, 128, 2);
    }
    for (let i = 0; i < 500; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      x.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 1);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  })();
  const conveyor = new THREE.Group();
  conveyor.position.set(-1, 0, 0);
  scene.add(conveyor);

  const beltMat = new THREE.MeshStandardMaterial({ map: beltTex, color: 0xffffff, roughness: 0.92, metalness: 0.05 });
  box(13, 0.08, 1.25, beltMat, 0, 0.98, 0, conveyor);
  box(13.1, 0.14, 0.09, M.steel, 0, 1.1, 0.69, conveyor);
  box(13.1, 0.14, 0.09, M.steel, 0, 1.1, -0.69, conveyor);
  box(13.05, 0.16, 0.08, M.steelDark, 0, 0.86, 0.6, conveyor);
  box(13.05, 0.16, 0.08, M.steelDark, 0, 0.86, -0.6, conveyor);
  [-5.6, -3.4, -1.2, 1.0, 3.2, 5.4].forEach((x) => {
    [-0.56, 0.56].forEach((z) => {
      box(0.09, 0.86, 0.09, M.steelSoft, x, 0.43, z, conveyor);
      box(0.22, 0.04, 0.22, M.steelDark, x, 0.02, z, conveyor);
    });
    box(0.07, 0.07, 1.12, M.steelSoft, x, 0.5, 0, conveyor);
  });
  const rollers = [];
  [-6.42, 6.42].forEach((x) => {
    const r = cyl(0.14, 0.14, 1.34, 18, M.steelDark, x, 0.98, 0, conveyor);
    r.rotation.x = Math.PI / 2;
    rollers.push(r);
  });
  // drive motor
  const motor = cyl(0.18, 0.18, 0.42, 16, M.steelDark, 6.5, 0.86, 0.78, conveyor);
  motor.rotation.x = Math.PI / 2;
  addLabel('CV-101 · CONVEYOR', -5.6, 2.05, 1.15, { height: 0.26 });

  // ------------------------------------------------------------------ parts
  const parts = [];
  const partGeo = new THREE.BoxGeometry(0.56, 0.38, 0.56);
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: RAW_COLOR.clone(), roughness: 0.55, metalness: 0.25 });
    const mesh = new THREE.Mesh(partGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const x = -7.15 + i * 2.45;
    mesh.position.set(x, 1.23, 0);
    scene.add(mesh);
    parts.push({
      mesh, mat, x, z: 0,
      state: 'belt',
      progress: 0,
      painted: false,
      target: new THREE.Color(PAINT_COLORS[i % PAINT_COLORS.length]),
    });
  }

  // ------------------------------------------------------------------ sensors
  const sensors = [];
  SENSOR_X.forEach((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    scene.add(g);
    // front post
    box(0.09, 1.42, 0.09, M.steelDark, 0, 0.71, 1.0, g);
    box(0.18, 0.04, 0.18, M.steelDark, 0, 0.02, 1.0, g);
    // rear reflector post
    box(0.07, 1.42, 0.07, M.steelDark, 0, 0.71, -1.0, g);
    box(0.18, 0.04, 0.18, M.steelDark, 0, 0.02, -1.0, g);
    // beam
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1.38, 0.94),
      new THREE.Vector3(0, 1.38, -0.94),
    ]);
    const beamMat = new THREE.LineBasicMaterial({ color: 0xff4d55, transparent: true, opacity: 0.55 });
    const beam = new THREE.Line(beamGeo, beamMat);
    g.add(beam);
    // lamp
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a1a1c, emissive: 0xff3038, emissiveIntensity: 0.2, roughness: 0.3 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), lampMat);
    lamp.position.set(0, 1.49, 1.0);
    g.add(lamp);
    box(0.16, 0.1, 0.16, M.black, 0, 1.45, 1.0, g);
    const label = makeLabel('ZS-' + (101 + i), { height: 0.18, color: '#b9cfe2', accent: '#ff6b70' });
    label.position.set(x, 1.86, 1.15);
    scene.add(label);
    sensors.push({ x, beamMat, lampMat, active: false });
  });

  // ------------------------------------------------------------------ spray gantry RB-101
  const gantry = new THREE.Group();
  scene.add(gantry);
  const railY = 2.92;
  [-1.85, 1.85].forEach((z) => {
    box(10.8, 0.12, 0.16, M.steel, -1.5, railY, z, gantry);
    [-6.3, 3.3].forEach((x) => {
      box(0.13, railY, 0.13, M.steelSoft, x, railY / 2, z, gantry);
      box(0.3, 0.04, 0.3, M.steelDark, x, 0.02, z, gantry);
    });
  });
  // cross braces
  [-6.3, 3.3].forEach((x) => box(0.08, 0.08, 3.7, M.steelSoft, x, 2.55, 0, gantry));

  const bridge = new THREE.Group();
  gantry.add(bridge);
  box(0.24, 0.2, 3.9, M.blue, 0, railY + 0.1, 0, bridge);
  box(0.34, 0.28, 0.44, M.steelDark, 0, railY - 0.06, 0, bridge);
  // hose loop
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 24, Math.PI * 1.4), M.black);
  hose.position.set(0.05, railY - 0.28, 0.18);
  hose.rotation.y = Math.PI / 2;
  bridge.add(hose);
  // nozzle
  const nozzleRod = cyl(0.035, 0.035, 0.34, 8, M.steelDark, 0, railY - 0.25, 0, bridge);
  nozzleRod.castShadow = false;
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 14), M.steel);
  nozzle.position.set(0, railY - 0.47, 0);
  bridge.add(nozzle);
  const nozzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 18), M.blueLight);
  nozzleRing.rotation.x = Math.PI / 2;
  nozzleRing.position.set(0, railY - 0.64, 0);
  bridge.add(nozzleRing);
  addLabel('RB-101 · SPRAY MANIPULATOR', -1.5, 3.6, 0, { height: 0.27, accent: '#3aa3e8' });

  // soft round particle texture (procedural, no external image)
  const softDot = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  // spray particles
  const SPRAY_N = 300;
  const sprayPos = new Float32Array(SPRAY_N * 3);
  const sprayVel = [];
  for (let i = 0; i < SPRAY_N; i++) {
    sprayPos[i * 3 + 1] = -40;
    sprayVel.push(new THREE.Vector3());
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  const sprayMat = new THREE.PointsMaterial({
    color: 0xcfeeff, size: 0.06, map: softDot, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const sprayPts = new THREE.Points(sprayGeo, sprayMat);
  sprayPts.frustumCulled = false;
  scene.add(sprayPts);
  let sprayCursor = 0;

  // ------------------------------------------------------------------ fan FN-101
  const fan = new THREE.Group();
  fan.position.set(-4.9, 1.78, -3.0);
  scene.add(fan);
  const fanBack = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.16, 32), M.steelDark);
  fanBack.rotation.x = Math.PI / 2;
  fanBack.position.z = -0.08;
  fan.add(fanBack);
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.05, 10, 40), M.steelSoft);
  fan.add(fanRing);
  const blades = new THREE.Group();
  blades.position.z = 0.02;
  fan.add(blades);
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (Math.PI * 2 / 5) * i;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.025), M.steel);
    b.position.y = 0.34;
    b.rotation.y = 0.55;
    b.castShadow = true;
    blade.add(b);
    blades.add(blade);
  }
  const hub = cyl(0.13, 0.13, 0.18, 18, M.blue, 0, 0, 0.09, fan);
  hub.rotation.x = Math.PI / 2;
  // guard rings
  [0.34, 0.56, 0.78].forEach((r) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 40), M.steelSoft);
    ring.position.z = 0.2;
    fan.add(ring);
  });
  for (let i = 0; i < 4; i++) {
    const spoke = box(0.02, 1.6, 0.02, M.steelSoft, 0, 0, 0.2, fan);
    spoke.rotation.z = i * Math.PI / 4 + Math.PI / 8;
  }
  cyl(0.08, 0.1, 1.5, 12, M.steelDark, 0, -0.85, -0.1, fan);
  box(0.7, 0.05, 0.7, M.steelDark, 0, -1.6, -0.1, fan);
  addLabel('FN-101 · FAN', -4.9, 3.05, -3.0, { height: 0.24 });

  // airflow
  const AIR_N = 100;
  const airPos = new Float32Array(AIR_N * 3);
  const airVel = [];
  for (let i = 0; i < AIR_N; i++) { airPos[i * 3 + 1] = -40; airVel.push(new THREE.Vector3()); }
  const airGeo = new THREE.BufferGeometry();
  airGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
  const airMat = new THREE.PointsMaterial({ color: 0x8fd6ff, size: 0.085, map: softDot, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const airPts = new THREE.Points(airGeo, airMat);
  airPts.frustumCulled = false;
  scene.add(airPts);
  let airCursor = 0;

  // ------------------------------------------------------------------ pick & place RB-102
  const ROBOT_POS = new THREE.Vector3(7.0, 0, 0.15);
  const L1 = 1.6, L2 = 1.3, SHOULDER_Y = 1.45;
  const robot = new THREE.Group();
  robot.position.copy(ROBOT_POS);
  scene.add(robot);
  cyl(0.46, 0.5, 0.34, 28, M.steelDark, 0, 0.17, 0, robot);
  cyl(0.3, 0.34, 1.1, 22, M.steel, 0, 0.87, 0, robot);
  box(0.68, 0.08, 0.68, M.blue, 0, 0.32, 0, robot);
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.02, 6, 28), new THREE.MeshStandardMaterial({ color: 0x22a3ff, emissive: 0x1f7fd0, emissiveIntensity: 0.8 }));
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.43;
  robot.add(baseRing);

  const yawGroup = new THREE.Group();
  yawGroup.position.y = SHOULDER_Y;
  robot.add(yawGroup);
  const shoulderJoint = cyl(0.27, 0.27, 0.52, 18, M.blue, 0, 0, 0, yawGroup);
  shoulderJoint.rotation.x = Math.PI / 2;
  shoulderJoint.castShadow = true;
  const shoulder = new THREE.Group();
  yawGroup.add(shoulder);
  const upperBeam = cyl(0.145, 0.13, L1 - 0.06, 18, M.white, L1 / 2, 0, 0, shoulder);
  upperBeam.rotation.z = Math.PI / 2;
  const upperStripe = box(L1 * 0.62, 0.03, 0.19, M.blue, L1 * 0.5, 0.135, 0, shoulder);
  upperStripe.rotation.z = 0;
  const conduit = cyl(0.035, 0.035, L1 * 0.78, 8, M.black, L1 * 0.52, -0.15, 0.09, shoulder);
  conduit.rotation.z = Math.PI / 2;
  const elbowJoint = cyl(0.2, 0.2, 0.4, 18, M.blueLight, L1, 0, 0, shoulder);
  elbowJoint.rotation.x = Math.PI / 2;
  const elbowRing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.018, 6, 20), M.steel);
  elbowRing.position.set(L1, 0, 0.205);
  shoulder.add(elbowRing);
  const elbow = new THREE.Group();
  elbow.position.x = L1;
  shoulder.add(elbow);
  const foreBeam = cyl(0.115, 0.1, L2 - 0.04, 16, M.white, L2 / 2, 0, 0, elbow);
  foreBeam.rotation.z = Math.PI / 2;
  box(L2 * 0.5, 0.03, 0.16, M.blue, L2 * 0.54, 0.11, 0, elbow);
  const wrist = new THREE.Group();
  wrist.position.x = L2;
  elbow.add(wrist);
  const wristJoint = cyl(0.13, 0.13, 0.28, 14, M.steelDark, 0, 0, 0, wrist);
  wristJoint.rotation.x = Math.PI / 2;
  box(0.18, 0.26, 0.4, M.steelDark, 0.16, 0, 0, wrist);
  const fingerA = box(0.38, 0.08, 0.07, M.steel, 0.42, 0, 0.3, wrist);
  const fingerB = box(0.38, 0.08, 0.07, M.steel, 0.42, 0, -0.3, wrist);
  const tip = new THREE.Object3D();
  tip.position.set(0.5, 0, 0);
  wrist.add(tip);
  const gripperLamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0x123a28, emissive: 0x39d98a, emissiveIntensity: 1.4 }));
  gripperLamp.position.set(0.16, 0.16, 0);
  wrist.add(gripperLamp);
  addLabel('RB-102 · PICK & PLACE', 7.0, 3.15, 0.15, { height: 0.22, accent: '#f2c14e' });

  // pallet
  const pallet = new THREE.Group();
  pallet.position.set(8.5, 0, 1.95);
  scene.add(pallet);
  for (let i = 0; i < 5; i++) {
    box(1.32, 0.05, 0.14, M.wood, 0, 0.15, -0.55 + i * 0.275, pallet);
  }
  box(0.14, 0.1, 1.25, M.woodDark, -0.5, 0.09, 0, pallet);
  box(0.14, 0.1, 1.25, M.woodDark, 0.5, 0.09, 0, pallet);
  box(1.3, 0.06, 0.14, M.woodDark, 0, 0.04, 0.5, pallet);
  addLabel('OUTPUT PALLET', 8.5, 1.8, 2.4, { height: 0.18, color: '#cfe0ee', accent: '#54c47c' });

  // pallet stack
  const palletParts = [];
  const PALLET_SLOTS = [];
  for (let i = 0; i < 8; i++) {
    PALLET_SLOTS.push({
      x: 8.2 + (i % 2) * 0.6,
      z: 1.66 + (Math.floor(i / 2) % 2) * 0.58,
      y: 0.37 + Math.floor(i / 4) * 0.39,
    });
  }

  // ------------------------------------------------------------------ control panel
  const panel = new THREE.Group();
  panel.position.set(-8.9, 0, 4.0);
  panel.rotation.y = 0.3;
  panel.scale.setScalar(1.12);
  scene.add(panel);
  box(1.5, 0.92, 0.62, M.cabinetDark, 0, 0.46, 0, panel);
  box(1.62, 0.06, 0.7, M.steelDark, 0, 0.93, 0, panel);
  box(1.9, 1.12, 0.18, M.cabinet, 0, 1.52, 0, panel);
  box(2.0, 0.07, 0.34, M.steelDark, 0, 2.1, 0.04, panel);
  box(0.08, 0.06, 0.3, M.black, -0.6, 2.03, 0.12, panel);
  box(0.08, 0.06, 0.3, M.black, 0.6, 2.03, 0.12, panel);
  addLabel('CONTROL PANEL · PS / ES', -8.9, 2.7, 4.0, { height: 0.24, accent: '#ffb547' });

  // panel face texture
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 768; panelCanvas.height = 448;
  (() => {
    const x = panelCanvas.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 448);
    g.addColorStop(0, '#2a333d'); g.addColorStop(1, '#141b22');
    x.fillStyle = g; x.fillRect(0, 0, 768, 448);
    x.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 448; i += 4) { x.beginPath(); x.moveTo(0, i); x.lineTo(768, i); x.stroke(); }
    x.fillStyle = '#0d141b'; x.fillRect(0, 0, 768, 76);
    x.fillStyle = '#dce9f5';
    x.font = '700 30px "Segoe UI", system-ui, sans-serif';
    x.fillText('CONTROL PANEL', 32, 48);
    x.fillStyle = '#6f8ea6';
    x.font = '600 17px "Segoe UI", system-ui, sans-serif';
    x.fillText('PLC_SCADA_HMI  ·  PS101–PS104 / ES101', 360, 46);
    const buttons = [
      { x: 130, y: 158, label: 'PS101', sub: 'START', color: '#2fbf71' },
      { x: 285, y: 158, label: 'PS102', sub: 'STOP', color: '#e05050' },
      { x: 440, y: 158, label: 'PS103', sub: 'AUTO', color: '#3aa3e8' },
      { x: 595, y: 158, label: 'PS104', sub: 'MANUAL', color: '#f0a63a' },
      { x: 130, y: 380, label: 'ES101', sub: 'E-STOP', color: '#e05050' },
    ];
    buttons.forEach((b) => {
      x.beginPath(); x.arc(b.x, b.y, 56, 0, Math.PI * 2);
      x.fillStyle = '#0b1218'; x.fill();
      x.strokeStyle = b.color + '55'; x.lineWidth = 4; x.stroke();
      x.fillStyle = b.color;
      x.font = '700 19px "Segoe UI", system-ui, sans-serif';
      x.textAlign = 'center';
      if (b.label === 'ES101') {
        x.textAlign = 'left';
        x.fillStyle = b.color;
        x.font = '700 18px "Segoe UI", system-ui, sans-serif';
        x.fillText('ES101', b.x + 82, b.y - 4);
        x.fillStyle = '#9fb6c9';
        x.font = '600 14px "Segoe UI", system-ui, sans-serif';
        x.fillText('E-STOP', b.x + 82, b.y + 18);
        x.textAlign = 'center';
      } else {
        x.fillText(b.label, b.x, b.y + 92);
        x.fillStyle = '#9fb6c9';
        x.font = '600 14px "Segoe UI", system-ui, sans-serif';
        x.fillText(b.sub, b.x, b.y + 113);
      }
      x.textAlign = 'left';
    });
    x.textAlign = 'center';
    x.fillStyle = '#4d6578';
    x.font = '600 13px "Segoe UI", system-ui, sans-serif';
    x.fillText('S7-1500  ·  WINCC  ·  24VDC', 384, 420);
  })();
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.encoding = THREE.sRGBEncoding;
  panelTex.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 1.04), new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.65, metalness: 0.25, emissive: 0xffffff, emissiveMap: panelTex, emissiveIntensity: 0.26 }));
  face.position.set(0, 1.52, 0.095);
  panel.add(face);

  const panelButtons = [];
  const buttonDefs = [
    { action: 'start', px: 130, py: 158, color: 0x2fbf71, r: 0.085, kind: 'push' },
    { action: 'stop', px: 285, py: 158, color: 0xe05050, r: 0.085, kind: 'push' },
    { action: 'auto', px: 440, py: 158, color: 0x3aa3e8, r: 0.085, kind: 'push' },
    { action: 'manual', px: 595, py: 158, color: 0xf0a63a, r: 0.085, kind: 'push' },
    { action: 'estop', px: 130, py: 380, color: 0xd63a3a, r: 0.125, kind: 'estop' },
  ];
  buttonDefs.forEach((b) => {
    const x = (b.px / 768 - 0.5) * 1.78;
    const y = 1.52 + (0.5 - b.py / 448) * 1.04;
    let mesh;
    if (b.kind === 'estop') {
      const baseMat = new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.5, metalness: 0.25 });
      const base = cyl(b.r * 1.2, b.r * 1.2, 0.05, 24, baseMat, x, y, 0.13, panel);
      base.rotation.x = Math.PI / 2;
      const mat = new THREE.MeshStandardMaterial({ color: 0x9e1b1b, roughness: 0.5, metalness: 0.12, emissive: 0x6e0e0e, emissiveIntensity: 0.35 });
      mesh = cyl(b.r, b.r * 0.9, 0.09, 24, mat, x, y, 0.19, panel);
      mesh.rotation.x = Math.PI / 2;
      mesh.userData = { action: b.action, mat, base: 0.5 };
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.42, metalness: 0.15, emissive: b.color, emissiveIntensity: 0.32 });
      mesh = cyl(b.r, b.r, 0.055, 24, mat, x, y, 0.14, panel);
      mesh.rotation.x = Math.PI / 2;
      mesh.userData = { action: b.action, mat, base: 0.25 };
    }
    mesh.castShadow = true;
    panelButtons.push(mesh);
  });

  // ------------------------------------------------------------------ HMI
  const hmi = new THREE.Group();
  hmi.position.set(-6.35, 0, 4.45);
  hmi.rotation.y = 0.16;
  hmi.scale.setScalar(1.15);
  scene.add(hmi);
  box(0.86, 0.96, 0.5, M.cabinetDark, 0, 0.48, 0, hmi);
  box(0.24, 0.22, 0.24, M.steelDark, 0, 1.0, 0, hmi);
  const hmiFrame = box(1.42, 0.92, 0.1, M.cabinet, 0, 1.56, 0.04, hmi);
  hmiFrame.rotation.x = -0.07;
  const hmiCanvas = document.createElement('canvas');
  hmiCanvas.width = 768; hmiCanvas.height = 480;
  const hmiCtx = hmiCanvas.getContext('2d');
  const hmiTex = new THREE.CanvasTexture(hmiCanvas);
  hmiTex.encoding = THREE.sRGBEncoding;
  hmiTex.anisotropy = 4;
  const hmiMat = new THREE.MeshStandardMaterial({ map: hmiTex, emissive: 0xffffff, emissiveMap: hmiTex, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.1 });
  const hmiScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.8), hmiMat);
  hmiScreen.position.set(0, 1.56, 0.102);
  hmiScreen.rotation.x = -0.07;
  hmiScreen.userData = { action: 'hmi' };
  hmi.add(hmiScreen);
  addLabel('HMI_1 · WINCC', -6.35, 2.65, 4.45, { height: 0.22, accent: '#35c2ff' });

  // HMI drawing -------------------------------------------------------
  function drawHMI() {
    const c = hmiCtx, W = 768, H = 480;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1724'); g.addColorStop(1, '#060e16');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // header
    c.fillStyle = '#0d2434'; c.fillRect(0, 0, W, 58);
    c.fillStyle = '#35c2ff'; c.fillRect(0, 56, W, 2);
    c.fillStyle = '#dcecf9';
    c.font = '700 24px "Segoe UI", system-ui, sans-serif';
    c.fillText('PLC_SCADA_HMI', 24, 37);
    c.fillStyle = '#5f8aa6';
    c.font = '600 15px "Segoe UI", system-ui, sans-serif';
    c.fillText('HMI_1  ·  LINE 01', 250, 36);
    c.textAlign = 'right';
    c.fillStyle = S.estop ? '#ff5a5f' : (S.running ? '#39d98a' : '#7f95a8');
    c.font = '700 17px "Segoe UI", system-ui, sans-serif';
    c.fillText(S.estop ? 'E-STOP' : (S.running ? 'RUNNING' : 'STOPPED'), 744, 36);
    c.textAlign = 'left';

    // tabs
    const tabs = ['MAIN PART', 'PID', 'ERROR STATUS'];
    tabs.forEach((t, i) => {
      const x = i * 256;
      c.fillStyle = S.screen === i ? '#123a52' : '#081521';
      c.fillRect(x, 60, 255, 40);
      c.fillStyle = S.screen === i ? '#35c2ff' : '#4b6a80';
      c.fillRect(x, 97, 255, 3);
      c.fillStyle = S.screen === i ? '#e6f4ff' : '#648399';
      c.font = '700 15px "Segoe UI", system-ui, sans-serif';
      c.fillText(t, x + 22, 86);
    });

    if (S.screen === 0) drawHmiMain();
    else if (S.screen === 1) drawHmiPid();
    else drawHmiError();

    // footer
    c.fillStyle = '#081420'; c.fillRect(0, H - 38, W, 38);
    c.fillStyle = '#0f2333'; c.fillRect(0, H - 38, W, 1);
    c.fillStyle = '#39d98a';
    c.beginPath(); c.arc(22, H - 19, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7d9ab0';
    c.font = '600 13px "Segoe UI", system-ui, sans-serif';
    c.fillText('PLC_1  ·  172.31.17.15  ·  PN/IE_1', 38, H - 14);
    c.textAlign = 'right';
    c.fillStyle = S.alarms ? '#ff6b70' : '#5f8aa6';
    c.fillText((S.alarms ? 'ALARM · ' + S.alarms : 'NO ALARMS'), W - 24, H - 14);
    c.textAlign = 'left';

    hmiTex.needsUpdate = true;
  }

  function drawHmiMain() {
    const c = hmiCtx;
    c.fillStyle = '#8fb0c6';
    c.font = '700 14px "Segoe UI", system-ui, sans-serif';
    c.fillText('LINE OVERVIEW', 24, 128);

    // conveyor map
    const left = 30, right = 470, y = 232;
    c.strokeStyle = '#24485f'; c.lineWidth = 2;
    c.strokeRect(left, y - 30, right - left, 60);
    c.fillStyle = '#0c1c27';
    c.fillRect(left + 2, y - 28, right - left - 4, 56);
    c.fillStyle = '#1b3748';
    c.fillRect(left + 6, y - 4, right - left - 12, 10);

    const mapX = (x) => left + ((x + 7.5) / 13) * (right - left);
    // stations
    const stations = [
      { x: -4.9, t: 'FN', color: '#3aa3e8' },
      { x: -1.5, t: 'RB101', color: '#3aa3e8' },
      { x: 1.4, t: 'ZS', color: '#7f95a8' },
      { x: 4.96, t: 'RB102', color: '#f2c14e' },
    ];
    stations.forEach((s) => {
      const sx = mapX(s.x);
      c.fillStyle = s.color + '33';
      c.fillRect(sx - 17, y - 58, 34, 20);
      c.strokeStyle = s.color + '88';
      c.strokeRect(sx - 17, y - 58, 34, 20);
      c.fillStyle = s.color;
      c.font = '700 10px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(s.t, sx, y - 44);
      c.textAlign = 'left';
    });
    // parts
    parts.forEach((p) => {
      const px = mapX(p.x);
      c.fillStyle = '#' + p.mat.color.getHexString();
      c.fillRect(px - 8, y - 16, 16, 12);
    });

    // counter cards
    const cards = [
      { x: 500, y: 120, w: 238, h: 62, label: 'PAINTED PARTS', val: String(S.painted), color: '#35c2ff' },
      { x: 500, y: 194, w: 238, h: 62, label: 'DELIVERED', val: String(S.delivered), color: '#54c47c' },
      { x: 500, y: 268, w: 238, h: 62, label: 'ALARMS', val: String(S.alarms), color: S.alarms ? '#ff5a5f' : '#7f95a8' },
    ];
    cards.forEach((k) => {
      c.fillStyle = '#0b1a25'; roundRect(c, k.x, k.y, k.w, k.h, 6); c.fill();
      c.strokeStyle = '#1c3a4d'; c.lineWidth = 1; c.stroke();
      c.fillStyle = '#6c8ba0';
      c.font = '600 11px "Segoe UI", system-ui, sans-serif';
      c.fillText(k.label, k.x + 14, k.y + 22);
      c.fillStyle = k.color;
      c.font = '700 28px "Segoe UI", system-ui, sans-serif';
      c.fillText(k.val, k.x + 14, k.y + 51);
    });

    // status lines
    const rows = [
      ['MODE', S.mode],
      ['BELT', S.belt > 0.1 ? 'RUN' : 'STOP'],
      ['SPRAY', S.sprayOn ? 'ACTIVE' : 'IDLE'],
      ['ROBOT', robotPhase.toUpperCase()],
    ];
    c.font = '600 12px "Segoe UI", system-ui, sans-serif';
    rows.forEach((r, i) => {
      const ry = 352 + i * 22;
      c.fillStyle = '#5f7f95'; c.fillText(r[0], 500, ry);
      c.fillStyle = r[1] === 'STOP' || r[1] === 'IDLE' ? '#7f95a8' : '#cfe6f5';
      c.textAlign = 'right'; c.fillText(r[1], 738, ry); c.textAlign = 'left';
    });

    // buttons row
    const btns = [
      { x: 30, label: 'START', on: S.running && !S.estop, color: '#2fbf71' },
      { x: 160, label: 'STOP', on: !S.running, color: '#e05050' },
      { x: 290, label: 'AUTO', on: S.mode === 'AUTO', color: '#3aa3e8' },
      { x: 420, label: 'MANU', on: S.mode === 'MANUAL', color: '#f0a63a' },
    ];
    btns.forEach((b) => {
      c.fillStyle = b.on ? b.color + '33' : '#0b1a25';
      roundRect(c, b.x, 378, 118, 46, 6); c.fill();
      c.strokeStyle = b.on ? b.color : '#24485f'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = b.on ? b.color : '#6c8ba0';
      c.font = '700 13px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(b.label, b.x + 59, 406);
      c.textAlign = 'left';
    });
  }

  function drawHmiPid() {
    const c = hmiCtx;
    c.fillStyle = '#8fb0c6';
    c.font = '700 14px "Segoe UI", system-ui, sans-serif';
    c.fillText('PID CONTROLLER · LOOP 1', 24, 128);

    c.fillStyle = '#0b1a25'; roundRect(c, 24, 148, 352, 248, 8); c.fill();
    c.strokeStyle = '#1c3a4d'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#6c8ba0'; c.font = '600 12px "Segoe UI", system-ui, sans-serif';
    c.fillText('PROCESS VALUE', 44, 176);
    c.fillStyle = '#e6f4ff'; c.font = '700 56px "Segoe UI", system-ui, sans-serif';
    c.fillText(S.pid.pv.toFixed(1), 44, 238);
    c.fillStyle = '#5f7f95'; c.font = '600 14px "Segoe UI", system-ui, sans-serif';
    c.fillText('SETPOINT  ' + S.pid.sp.toFixed(0), 44, 268);
    // bar
    c.fillStyle = '#0a1520'; roundRect(c, 44, 290, 312, 12, 6); c.fill();
    const pct = clamp(S.pid.pv / 100, 0, 1);
    const grad = c.createLinearGradient(44, 0, 356, 0);
    grad.addColorStop(0, '#1f6db5'); grad.addColorStop(1, '#35c2ff');
    c.fillStyle = grad; roundRect(c, 44, 290, Math.max(8, 312 * pct), 12, 6); c.fill();
    // trend
    c.strokeStyle = '#2fbf71'; c.lineWidth = 2; c.beginPath();
    pidHistory.forEach((v, i) => {
      const tx = 44 + (i / (pidHistory.length - 1)) * 312;
      const ty = 404 - (v / 100) * 70;
      if (i === 0) c.moveTo(tx, ty); else c.lineTo(tx, ty);
    });
    c.stroke();
    c.strokeStyle = '#f0a63a55'; c.setLineDash([4, 4]);
    const sy = 404 - (S.pid.sp / 100) * 70;
    c.beginPath(); c.moveTo(44, sy); c.lineTo(356, sy); c.stroke(); c.setLineDash([]);

    // gains
    const gains = [['K_p', S.pid.kp.toFixed(2)], ['K_i', S.pid.ki.toFixed(3)], ['K_d', S.pid.kd.toFixed(3)]];
    gains.forEach((g, i) => {
      const x = 400, y = 148 + i * 82;
      c.fillStyle = '#0b1a25'; roundRect(c, x, y, 338, 66, 6); c.fill();
      c.strokeStyle = '#1c3a4d'; c.stroke();
      c.fillStyle = '#6c8ba0'; c.font = '600 12px "Segoe UI", system-ui, sans-serif';
      c.fillText(g[0], x + 16, y + 24);
      c.fillStyle = '#e6f4ff'; c.font = '700 26px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'right'; c.fillText(g[1], x + 322, y + 44); c.textAlign = 'left';
    });
    c.fillStyle = '#0b1a25'; roundRect(c, 400, 394, 338, 60, 6); c.fill();
    c.strokeStyle = '#1c3a4d'; c.stroke();
    c.fillStyle = '#6c8ba0'; c.font = '600 12px "Segoe UI", system-ui, sans-serif';
    c.fillText('CONTROL OUTPUT', 416, 418);
    c.fillStyle = '#35c2ff'; c.font = '700 24px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'right'; c.fillText(S.pid.out.toFixed(1) + ' %', 722, 438); c.textAlign = 'left';
  }

  function drawHmiError() {
    const c = hmiCtx;
    c.fillStyle = '#8fb0c6';
    c.font = '700 14px "Segoe UI", system-ui, sans-serif';
    c.fillText('ALARM / DIAGNOSTICS', 24, 128);
    if (S.estop) {
      c.fillStyle = '#3a1014'; roundRect(c, 24, 142, 720, 46, 6); c.fill();
      c.strokeStyle = '#ff5a5f'; c.stroke();
      c.fillStyle = '#ff8b8f'; c.font = '700 18px "Segoe UI", system-ui, sans-serif';
      c.fillText('EMERGENCY STOP ACTIVE — RESET REQUIRED', 44, 171);
    }
    const alarms = [
      ['ALM_XA101_CV101', 'Conveyor fault', S.sims.cv],
      ['ALM_XA103_RB101', 'Spray manipulator fault', S.sims.rb101],
      ['ALM_XA104_RB102', 'Pick & place fault', S.sims.rb102],
      ['ALM_XA102_FN101', 'Fan fault', S.sims.fn],
    ];
    alarms.forEach((a, i) => {
      const y = (S.estop ? 206 : 150) + i * 52;
      c.fillStyle = a[2] ? '#2a1114' : '#0b1a25';
      roundRect(c, 24, y, 720, 42, 5); c.fill();
      c.strokeStyle = a[2] ? '#ff5a5f55' : '#1c3a4d'; c.stroke();
      c.fillStyle = a[2] ? '#ff5a5f' : '#39d98a';
      c.beginPath(); c.arc(46, y + 21, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = a[2] ? '#ffd4d6' : '#b9cfe2';
      c.font = '600 14px "Segoe UI", system-ui, sans-serif';
      c.fillText(a[0], 66, y + 26);
      c.fillStyle = '#6c8ba0'; c.font = '500 12px "Segoe UI", system-ui, sans-serif';
      c.fillText(a[1], 300, y + 26);
      c.fillStyle = a[2] ? '#ff8b8f' : '#4d6578';
      c.font = '700 11px "Segoe UI", system-ui, sans-serif';
      c.textAlign = 'right';
      c.fillText(a[2] ? 'SIM ON' : 'OK', 726, y + 26);
      c.textAlign = 'left';
    });
    c.fillStyle = '#0b1a25'; roundRect(c, 558, 372, 186, 48, 6); c.fill();
    c.strokeStyle = S.alarms ? '#ff5a5f88' : '#24485f'; c.stroke();
    c.fillStyle = S.alarms ? '#ff8b8f' : '#5f7f95';
    c.font = '700 13px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('REPAIR ALL', 651, 401);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------------ PLC cabinet
  const cabinet = new THREE.Group();
  cabinet.position.set(-11.4, 0, -1.9);
  cabinet.rotation.y = 0.1;
  scene.add(cabinet);
  box(1.25, 2.25, 0.72, M.cabinet, 0, 1.125, 0, cabinet);
  box(1.32, 0.08, 0.8, M.steelDark, 0, 2.29, 0, cabinet);
  box(1.05, 1.35, 0.03, M.cabinetDark, 0, 1.0, 0.375, cabinet);
  box(0.04, 1.3, 0.04, M.steel, 0.49, 1.0, 0.4, cabinet);
  // upper window with modules
  box(1.05, 0.6, 0.04, M.glass, 0, 1.86, 0.38, cabinet);
  const modX = [-0.34, -0.2, -0.06, 0.08, 0.22, 0.36];
  modX.forEach((mx, i) => {
    const h = i === 0 ? 0.5 : 0.42;
    const m = box(0.11, h, 0.09, i === 0 ? M.blue : M.steelSoft, mx, 1.86, 0.34, cabinet);
    m.castShadow = false;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0d3322, emissive: 0x39d98a, emissiveIntensity: 1.4 }));
    led.position.set(mx + 0.03, 1.86 - h / 2 + 0.05, 0.39);
    cabinet.add(led);
  });
  box(0.98, 0.08, 0.05, M.steelDark, 0, 1.58, 0.39, cabinet);
  addLabel('PLC_1 · CPU 1513F-1 PN', -11.4, 2.7, -1.9, { height: 0.23, accent: '#1f6db5' });

  // ET 200SP
  const et = new THREE.Group();
  et.position.set(2.8, 0, -2.9);
  et.rotation.y = -0.15;
  scene.add(et);
  box(1.1, 0.12, 0.46, M.steelDark, 0, 0.78, 0, et);
  box(0.1, 0.72, 0.1, M.steelSoft, -0.45, 0.36, 0, et);
  box(0.1, 0.72, 0.1, M.steelSoft, 0.45, 0.36, 0, et);
  box(1.3, 0.04, 1.0, M.steelDark, 0, 0.03, 0, et);
  const etModules = [
    [0.3, 0.22, M.steelDark],
    [-0.05, 0.2, M.blue],
    [-0.29, 0.18, M.steelSoft],
    [-0.5, 0.18, M.steelSoft],
  ];
  etModules.forEach(([mx, w, mat], i) => {
    box(w, 0.55, 0.38, mat, mx, 1.06, 0, et);
    box(w * 0.8, 0.05, 0.4, M.blueLight, mx, 1.35, 0, et).castShadow = false;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0d3322, emissive: 0x39d98a, emissiveIntensity: 1.2 }));
    led.position.set(mx + w * 0.25, 1.22, 0.2);
    et.add(led);
  });
  addLabel('ET 200SP · IM 155-6 PN ST', 2.8, 1.75, -2.9, { height: 0.2, accent: '#1f6db5' });

  // network cable from ET200SP to PLC area
  (() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(2.3, 0.05, -2.7),
      new THREE.Vector3(0.5, 0.05, -2.8),
      new THREE.Vector3(-3.0, 0.05, -3.1),
      new THREE.Vector3(-6.0, 0.05, -3.2),
      new THREE.Vector3(-9.0, 0.05, -3.0),
      new THREE.Vector3(-11.4, 0.05, -2.3),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.025, 5, false), M.black);
    tube.castShadow = false;
    scene.add(tube);
  })();

  // ------------------------------------------------------------------ lights
  scene.add(new THREE.HemisphereLight(0x7fa9c9, 0x080d11, 0.33));
  const key = new THREE.DirectionalLight(0xffedcf, 1.8);
  key.position.set(11, 17, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 50;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.PointLight(0x54b8ff, 0.75, 18, 2);
  fill.position.set(-1.5, 4.4, 1.5);
  scene.add(fill);
  const warm = new THREE.PointLight(0xffb46b, 0.85, 14, 2);
  warm.position.set(-9.0, 2.8, 4.5);
  scene.add(warm);
  const robotLight = new THREE.PointLight(0x9fd8ff, 1.05, 12, 2);
  robotLight.position.set(7.0, 3.6, 1.5);
  scene.add(robotLight);
  const beltGlow = new THREE.PointLight(0x2e8fd6, 0.45, 9, 2);
  beltGlow.position.set(-1.5, 0.9, 1.3);
  scene.add(beltGlow);

  // ------------------------------------------------------------------ simulation
  let robotPhase = 'idle';
  let robotT = 0;
  let robotDur = 0;
  let robotPart = null;
  let robotCooldown = 0;
  let rack = 0;
  const robotPos = new THREE.Vector3(6.12, 2.55, 0.42);
  const robotTarget = new THREE.Vector3(6.12, 2.55, 0.42);
  const vTmp = new THREE.Vector3();
  const vDown = new THREE.Vector3(0, -1, 0);
  let hmiDirty = true;

  function alarmsCount() {
    return Object.values(S.sims).filter(Boolean).length + (S.estop ? 1 : 0);
  }
  S.alarms = 0;

  function resetPart(p, index) {
    p.state = 'belt';
    p.x = -7.35 - (index || 0) * 0.35;
    p.progress = 0;
    p.painted = false;
    p.mat.color.copy(RAW_COLOR);
    p.mat.emissive.setHex(0x000000);
    p.mat.emissiveIntensity = 0;
    p.mesh.position.set(p.x, 1.23, 0);
    p.mesh.visible = true;
  }

  function deliverPart(p) {
    const slotIndex = S.delivered % 8;
    const slot = PALLET_SLOTS[slotIndex];
    const clone = new THREE.Mesh(partGeo, p.mat.clone());
    clone.position.set(slot.x, slot.y, slot.z);
    clone.castShadow = true;
    clone.receiveShadow = true;
    scene.add(clone);
    palletParts.push(clone);
    if (palletParts.length > 8) {
      const old = palletParts.shift();
      scene.remove(old);
      old.material.dispose();
    }
    S.delivered++;
    resetPart(p, 0);
  }

  function startPick() {
    const p = parts.find((q) => q.state === 'belt' && q.x > 4.45);
    if (!p) return false;
    robotPart = p;
    p.state = 'reserved';
    p.x = 4.72;
    p.mesh.position.x = 4.72;
    robotPhase = 'approach';
    robotT = 0;
    robotDur = 0.45;
    robotTarget.set(4.72, 2.3, 0);
    return true;
  }

  function setPhase(name, dur, x, y, z) {
    robotPhase = name;
    robotT = 0;
    robotDur = dur;
    robotTarget.set(x, y, z);
    if (name === 'grab') {
      if (robotPart) robotPart.state = 'held';
    }
  }

  function updateRobot(dt, enabled) {
    if (!enabled) {
      robotCooldown = Math.max(0, robotCooldown - dt);
      return;
    }
    robotCooldown = Math.max(0, robotCooldown - dt);
    if (robotPhase === 'idle') {
      robotTarget.set(6.12, 2.55, 0.42);
      if (robotCooldown <= 0 && startPick()) {
        // started
      }
    } else {
      robotT += dt;
      if (robotT >= robotDur) {
        robotT = 0;
        if (robotPhase === 'approach') setPhase('down', 0.42, 4.72, 1.92, 0);
        else if (robotPhase === 'down') setPhase('grab', 0.26, 4.72, 1.92, 0);
        else if (robotPhase === 'grab') setPhase('lift', 0.5, 4.72, 2.5, 0);
        else if (robotPhase === 'lift') {
          setPhase('swing', 0.95, 8.5, 2.42, 1.95);
        } else if (robotPhase === 'swing') {
          const slot = PALLET_SLOTS[S.delivered % 8];
          setPhase('place', 0.5, slot.x, slot.y + 0.69, slot.z);
        } else if (robotPhase === 'place') setPhase('release', 0.24, PALLET_SLOTS[S.delivered % 8].x, PALLET_SLOTS[S.delivered % 8].y + 0.69, PALLET_SLOTS[S.delivered % 8].z);
        else if (robotPhase === 'release') {
          if (robotPart) deliverPart(robotPart);
          robotPart = null;
          setPhase('retract', 0.45, 8.5, 2.42, 1.95);
        } else if (robotPhase === 'retract') setPhase('home', 0.85, 6.12, 2.55, 0.42);
        else if (robotPhase === 'home') {
          robotPhase = 'idle';
          robotCooldown = 0.25;
        }
      }
    }

    const k = 1 - Math.exp(-(robotPhase === 'idle' ? 5 : 9) * dt);
    robotPos.lerp(robotTarget, k);

    // IK
    const tx = robotPos.x - ROBOT_POS.x;
    const ty = robotPos.y;
    const tz = robotPos.z - ROBOT_POS.z;
    const r = Math.hypot(tx, tz);
    const dy = ty - SHOULDER_Y;
    const yaw = Math.atan2(-tz, tx);
    let D = Math.hypot(r, dy);
    D = clamp(D, 0.55, L1 + L2 - 0.02);
    const a1 = Math.atan2(dy, r) + Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const a2 = -Math.acos(clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    yawGroup.rotation.y = yaw;
    shoulder.rotation.z = a1;
    elbow.rotation.z = a2;
    wrist.rotation.z = -Math.PI / 2 - a1 - a2;

    const grip = robotPart ? 0.285 : 0.36;
    fingerA.position.z += (grip - fingerA.position.z) * Math.min(1, dt * 10);
    fingerB.position.z += (-grip - fingerB.position.z) * Math.min(1, dt * 10);

    robot.updateMatrixWorld(true);
    if (robotPart && robotPart.state === 'held') {
      tip.getWorldPosition(vTmp);
      robotPart.mesh.position.copy(vTmp).addScaledVector(vDown, 0.19);
      robotPart.x = robotPart.mesh.position.x;
      robotPart.mesh.rotation.y = 0;
    }

    gripperLamp.material.emissiveIntensity = robotPart ? 2.2 : 0.6;
  }

  function updateParts(dt, live) {
    const beltSpeed = S.belt * 1.05;
    const active = parts.filter((p) => p.state === 'belt').sort((a, b) => b.x - a.x);
    let frontLimit = 4.72;
    const blocker = parts.find((p) => p.state === 'reserved');
    if (blocker) frontLimit = Math.min(frontLimit, blocker.x - 1.18);
    for (const p of active) {
      if (p.x < frontLimit) {
        p.x = Math.min(frontLimit, p.x + beltSpeed * dt);
      }
      frontLimit = p.x - 1.18;
    }
    parts.forEach((p) => {
      if (p.state !== 'held') {
        p.mesh.position.x = p.x;
        p.mesh.position.y = 1.23;
      }
      if (p.progress > 0 && !p.painted) {
        const c = Math.min(1, p.progress);
        p.mat.color.copy(RAW_COLOR).lerp(p.target, c);
        p.mat.emissive.copy(p.target).multiplyScalar(0.18 * (1 - c));
      } else if (p.painted) {
        p.mat.color.copy(p.target);
      }
    });
  }

  // ------------------------------------------------------------------ UI
  const els = {
    runText: $('#runText'), runLed: $('#runLed'), modeChip: $('#modeChip'),
    painted: $('#vPainted'), delivered: $('#vDelivered'), alarms: $('#vAlarms'),
    cv: $('#vCv'), rb101: $('#vRb101'), rb102: $('#vRb102'), fn: $('#vFn'),
    pidSp: $('#pidSp'), pidPv: $('#pidPv'), pidVal: $('#pidVal'),
    toast: $('#toast'), simWrap: $('#simWrap'),
  };
  let toastTimer = 0;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }
  function refreshHUD() {
    const run = S.estop ? 'E-STOP' : S.running ? 'RUNNING' : 'STOPPED';
    els.runText.textContent = run;
    els.runLed.className = 'led ' + (S.estop ? 'red' : S.running ? 'green' : 'idle');
    els.modeChip.textContent = S.mode;
    els.modeChip.className = 'chip ' + (S.mode === 'AUTO' ? 'auto' : 'manual');
    els.painted.textContent = S.painted;
    els.delivered.textContent = S.delivered;
    els.alarms.textContent = alarmsCount();
    els.cv.textContent = S.estop ? 'HALT' : S.belt > 0.05 ? 'RUN' : 'STOP';
    els.rb101.textContent = S.sprayOn ? 'SPRAY' : 'IDLE';
    els.rb102.textContent = robotPhase.toUpperCase();
    els.fn.textContent = S.estop ? 'HALT' : S.fan > 0.05 ? 'RUN' : 'STOP';
    els.pidVal.textContent = S.pid.pv.toFixed(1);
    els.pidSp.textContent = S.pid.sp.toFixed(0);
    els.pidPv.style.width = clamp(S.pid.pv, 0, 100) + '%';
    document.querySelectorAll('[data-tbtn]').forEach((b) => {
      const a = b.dataset.tbtn;
      b.classList.toggle('active', (a === 'auto' && S.mode === 'AUTO') || (a === 'manual' && S.mode === 'MANUAL'));
    });
    document.querySelectorAll('[data-jog]').forEach((b) => {
      b.classList.toggle('active', !!S.jog[b.dataset.jog]);
      b.disabled = S.mode !== 'MANUAL' || S.estop;
    });
    document.querySelectorAll('[data-sim]').forEach((input) => {
      input.checked = !!S.sims[input.dataset.sim];
    });
  }

  function act(action) {
    switch (action) {
      case 'start':
        if (S.estop) { toast('急停未复位 — 请先 RESET'); return; }
        S.running = true; toast('启动 · LINE RUNNING'); break;
      case 'stop':
        S.running = false; toast('停止 · LINE STOPPED'); break;
      case 'auto':
        if (S.estop) { toast('急停中，无法切换模式'); return; }
        S.mode = 'AUTO';
        S.jog = { cv: false, fn: false, rb101: false, rb102: false };
        toast('切换至 AUTO 自动模式'); break;
      case 'manual':
        if (S.estop) { toast('急停中，无法切换模式'); return; }
        S.mode = 'MANUAL';
        toast('切换至 MANUAL 手动模式'); break;
      case 'estop':
        S.estop = true; S.running = false;
        S.jog = { cv: false, fn: false, rb101: false, rb102: false };
        toast('紧急停止 ES101 已按下'); break;
      case 'reset':
        S.estop = false; S.running = false;
        S.sims = { cv: false, rb101: false, rb102: false, fn: false };
        S.jog = { cv: false, fn: false, rb101: false, rb102: false };
        S.pid.pv = 24;
        toast('复位完成 · ALARMS CLEARED'); break;
      case 'repair':
        S.sims = { cv: false, rb101: false, rb102: false, fn: false };
        toast('Repair all · 故障已清除'); break;
      case 'hmi':
        S.screen = (S.screen + 1) % 3; hmiDirty = true; break;
    }
    S.alarms = alarmsCount();
    refreshHUD();
    hmiDirty = true;
  }

  document.querySelectorAll('[data-action], [data-tbtn]').forEach((b) => {
    b.addEventListener('click', () => act(b.dataset.action || b.dataset.tbtn));
  });
  document.querySelectorAll('[data-jog]').forEach((b) => {
    b.addEventListener('click', () => {
      if (S.mode !== 'MANUAL') { toast('手动点动仅在 MANUAL 模式可用'); return; }
      if (S.estop) { toast('急停中'); return; }
      const k = b.dataset.jog;
      S.jog[k] = !S.jog[k];
      if (!S.running) S.running = true;
      refreshHUD();
      toast('手动 ' + k.toUpperCase() + (S.jog[k] ? ' ON' : ' OFF'));
    });
  });
  document.querySelectorAll('[data-sim]').forEach((input) => {
    input.addEventListener('change', () => {
      S.sims[input.dataset.sim] = input.checked;
      S.alarms = alarmsCount();
      refreshHUD();
      hmiDirty = true;
      toast((input.checked ? '注入故障 · ' : '清除故障 · ') + 'SIM_' + input.dataset.sim.toUpperCase());
    });
  });
  const spSlider = $('#spRange');
  spSlider.addEventListener('input', () => {
    S.pid.sp = Number(spSlider.value);
    els.pidSp.textContent = S.pid.sp;
    hmiDirty = true;
  });
  $('#viewReset').addEventListener('click', () => {
    cam.theta = 0.66; cam.phi = 1.12; cam.radius = 19.5;
    cam.target.set(0.0, 1.4, 0.5);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); act(S.running ? 'stop' : 'start'); }
    else if (k === 'a') act('auto');
    else if (k === 'm') act('manual');
    else if (k === 'e') act('estop');
    else if (k === 'r') act('reset');
    else if (k === 'h') act('hmi');
  });

  // ------------------------------------------------------------------ camera controls
  const cam = { theta: 0.66, phi: 1.12, radius: 19.5, target: new THREE.Vector3(0.0, 1.4, 0.5) };
  if (window.innerWidth < 900) {
    cam.radius = 16.0;
    cam.phi = 1.14;
    cam.target.set(0.0, 1.55, 0.45);
  } else if (window.innerWidth < 1200) {
    cam.radius = 18.0;
    cam.target.set(0.0, 1.45, 0.5);
  }
  let drag = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const interactive = [...panelButtons, hmiScreen];

  function updateCamera() {
    const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
    camera.position.set(
      cam.target.x + cam.radius * sp * Math.sin(cam.theta),
      cam.target.y + cam.radius * cp,
      cam.target.z + cam.radius * sp * Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);
  }
  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function pick(e) {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(interactive, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.action) obj = obj.parent;
    return obj ? { obj, hit: hits[0] } : null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, button: e.button };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const hit = pick(e);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.button === 2 || e.shiftKey) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const f = cam.radius * 0.0012;
      cam.target.addScaledVector(right, -dx * f);
      cam.target.addScaledVector(up, dy * f);
    } else {
      cam.theta -= dx * 0.005;
      cam.phi = clamp(cam.phi - dy * 0.005, 0.25, 1.45);
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 6) {
      const hit = pick(e);
      if (hit) {
        if (hit.obj.userData.action === 'hmi') {
          if (hit.hit.uv && hit.hit.uv.y > 0.79) {
            const u = hit.hit.uv.x;
            S.screen = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2;
            hmiDirty = true;
          } else {
            S.screen = (S.screen + 1) % 3;
            hmiDirty = true;
          }
        } else {
          act(hit.obj.userData.action);
        }
      }
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.radius = clamp(cam.radius * Math.exp(e.deltaY * 0.001), 8, 55);
  }, { passive: false });

  // ------------------------------------------------------------------ status LEDs
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a1012, emissive: 0xff3038, emissiveIntensity: 0.2, roughness: 0.35 });
  const beaconBase = cyl(0.09, 0.11, 0.22, 12, M.steelDark, -8.3, 2.45, 3.8);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), beaconMat);
  beacon.position.set(-8.3, 2.6, 3.8);
  scene.add(beacon);
  const runLamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshStandardMaterial({ color: 0x0d3322, emissive: 0x39d98a, emissiveIntensity: 1.2 }));
  runLamp.position.set(-8.3, 2.42, 3.94);
  scene.add(runLamp);

  // ------------------------------------------------------------------ loop
  const clock = new THREE.Clock();
  let uiTimer = 0;
  let hmiTimer = 0;
  let pidTimer = 0;

  function updateSim(dt) {
    const live = S.running && !S.estop;
    const auto = live && S.mode === 'AUTO';
    const manual = live && S.mode === 'MANUAL';

    const beltTarget = auto ? (S.sims.cv ? 0 : 1) : (manual && S.jog.cv && !S.sims.cv ? 1 : 0);
    const fanTarget = auto ? (S.sims.fn ? 0 : 1) : (manual && S.jog.fn && !S.sims.fn ? 1 : 0);
    S.belt += (beltTarget - S.belt) * Math.min(1, dt * 3.2);
    S.fan += (fanTarget - S.fan) * Math.min(1, dt * 2.4);
    if (Math.abs(S.belt) < 0.003) S.belt = 0;
    if (Math.abs(S.fan) < 0.003) S.fan = 0;

    const robotEnabled = auto ? !S.sims.rb102 : (manual && S.jog.rb102 && !S.sims.rb102);
    updateRobot(dt, robotEnabled);

    updateParts(dt, live);

    // spray target tracking
    let sprayTarget = null;
    if (!S.sims.rb101) {
      const candidates = parts.filter((p) => p.state === 'belt' && !p.painted && p.x > -3.4 && p.x < -0.2);
      candidates.sort((a, b) => a.x - b.x);
      sprayTarget = candidates[0] || null;
    }
    const desiredX = sprayTarget ? clamp(sprayTarget.x, -3.3, -0.25) : -1.75;
    bridge.position.x += (desiredX - bridge.position.x) * Math.min(1, dt * 4.5);
    bridge.position.z = Math.sin(performance.now() * 0.0012) * 0.04;

    const sprayAllowed = (auto ? S.belt > 0.08 : (manual && S.jog.rb101)) && !S.sims.rb101 && !S.estop;
    let sprayNow = false;
    if (sprayAllowed && sprayTarget && Math.abs(sprayTarget.x - bridge.position.x) < 0.42) {
      sprayNow = true;
      sprayTarget.progress = Math.min(1.001, sprayTarget.progress + dt * 0.62);
      if (sprayTarget.progress >= 1 && !sprayTarget.painted) {
        sprayTarget.painted = true;
        S.painted++;
        hmiDirty = true;
      }
    }
    S.sprayOn = sprayNow;

    // blade & belt animation
    blades.rotation.z -= S.fan * dt * 9.5;
    beltTex.offset.x -= S.belt * dt * 0.65;
    rollers.forEach((r) => r.rotateOnAxis(new THREE.Vector3(0, 1, 0), -S.belt * dt * 3));

    // spray particles
    if (sprayNow) {
      const n = Math.floor(dt * 1100) + 3;
      for (let i = 0; i < n; i++) {
        const idx = sprayCursor++ % SPRAY_N;
        sprayPos[idx * 3] = bridge.position.x + rand(-0.045, 0.045);
        sprayPos[idx * 3 + 1] = 2.33;
        sprayPos[idx * 3 + 2] = bridge.position.z + rand(-0.045, 0.045);
        sprayVel[idx].set(rand(-0.55, 0.55), rand(-2.9, -2.0), rand(-0.55, 0.55));
      }
    }
    for (let i = 0; i < SPRAY_N; i++) {
      const y = sprayPos[i * 3 + 1];
      if (y > 1.38) {
        const v = sprayVel[i];
        sprayPos[i * 3] += v.x * dt;
        sprayPos[i * 3 + 1] += v.y * dt;
        sprayPos[i * 3 + 2] += v.z * dt;
        v.y -= 5.0 * dt;
      } else if (y > -20) {
        sprayPos[i * 3 + 1] = -40;
      }
    }
    sprayGeo.attributes.position.needsUpdate = true;
    sprayMat.opacity = 0.55;

    // airflow particles
    const airOn = S.fan > 0.15;
    if (airOn) {
      const n = Math.floor(dt * (120 * S.fan)) + 1;
      for (let i = 0; i < n; i++) {
        const idx = airCursor++ % AIR_N;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * 0.65;
        airPos[idx * 3] = -4.9 + Math.cos(a) * rad;
        airPos[idx * 3 + 1] = 1.78 + Math.sin(a) * rad;
        airPos[idx * 3 + 2] = -2.82;
        airVel[idx].set(rand(-0.1, 0.1), rand(-0.1, 0.1), rand(2.0, 3.4) * S.fan);
      }
    }
    for (let i = 0; i < AIR_N; i++) {
      if (airPos[i * 3 + 2] > -25 && airPos[i * 3 + 2] < 3.5) {
        airPos[i * 3] += airVel[i].x * dt;
        airPos[i * 3 + 1] += airVel[i].y * dt;
        airPos[i * 3 + 2] += airVel[i].z * dt;
        if (airPos[i * 3 + 2] > 3.2) airPos[i * 3 + 2] = -30;
      }
    }
    airGeo.attributes.position.needsUpdate = true;
    airMat.opacity = 0.14 + S.fan * 0.24;

    // sensors
    sensors.forEach((s) => {
      const on = parts.some((p) => p.state !== 'held' && Math.abs(p.x - s.x) < 0.3 && p.mesh.visible);
      s.active = on;
      s.beamMat.color.setHex(on ? 0x39d98a : 0xff4d55);
      s.beamMat.opacity = on ? 0.9 : 0.4;
      s.lampMat.color.setHex(on ? 0x0d3322 : 0x3a1a1c);
      s.lampMat.emissive.setHex(on ? 0x39d98a : 0xff3038);
      s.lampMat.emissiveIntensity = on ? 2.0 : 0.2;
    });

    // PID
    const pvTarget = live ? S.pid.sp : 20 + Math.sin(performance.now() * 0.0006) * 3;
    S.pid.pv += (pvTarget - S.pid.pv) * Math.min(1, dt * 0.55) + rand(-0.15, 0.15) * dt * 4;
    S.pid.pv = clamp(S.pid.pv, 0, 100);
    S.pid.out = clamp(50 + (S.pid.sp - S.pid.pv) * 1.4, 0, 100);
    pidTimer += dt;
    if (pidTimer > 0.22) {
      pidTimer = 0;
      pidHistory.push(S.pid.pv);
      if (pidHistory.length > 96) pidHistory.shift();
      hmiDirty = true;
    }

    // beacon / lamps
    const alarm = alarmsCount() > 0;
    const flash = 0.6 + Math.sin(performance.now() * 0.012) * 0.6;
    beaconMat.emissiveIntensity = alarm ? flash : 0.05;
    beaconMat.color.setHex(alarm ? 0x7a2a2a : 0x2a2a2a);
    runLamp.material.emissiveIntensity = S.running && !S.estop ? 1.4 : 0.1;
    runLamp.material.color.setHex(S.running && !S.estop ? 0x1d6b44 : 0x0d3322);

    // panel button LEDs
    panelButtons.forEach((b) => {
      const a = b.userData.action;
      let on = 0;
      if (a === 'start') on = S.running && !S.estop;
      else if (a === 'stop') on = !S.running || S.estop;
      else if (a === 'auto') on = S.mode === 'AUTO';
      else if (a === 'manual') on = S.mode === 'MANUAL';
      else if (a === 'estop') on = S.estop || alarm;
      b.userData.mat.emissiveIntensity = on ? 1.05 : 0.22;
    });

    S.alarms = alarmsCount();
  }

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.1);
    updateSim(dt);
    updateCamera();

    uiTimer += dt;
    if (uiTimer > 0.18) { uiTimer = 0; refreshHUD(); }
    hmiTimer += dt;
    if (hmiDirty && hmiTimer > 0.12) {
      hmiTimer = 0;
      hmiDirty = false;
      drawHMI();
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // debug handles (harmless in production)
  window.__view = cam;
  window.__state = S;
  window.__act = act;
  window.__debug = {
    get parts() { return parts.map((p) => ({ x: +p.x.toFixed(2), state: p.state, painted: p.painted, progress: +p.progress.toFixed(2) })); },
    get robot() {
      const tw = new THREE.Vector3();
      tip.getWorldPosition(tw);
      return {
        phase: robotPhase,
        pos: robotPos.toArray().map((v) => +v.toFixed(2)),
        tip: tw.toArray().map((v) => +v.toFixed(2)),
        held: robotPart ? +robotPart.x.toFixed(2) : null,
      };
    },
    get spray() { return { x: +bridge.position.x.toFixed(2), on: S.sprayOn }; },
  };
  window.__step = (n, dt = 0.05) => { for (let i = 0; i < n; i++) updateSim(dt); };
  window.__panelButtons = panelButtons;
  window.__hmiScreen = hmiScreen;
  window.__camera = camera;
  window.__sprayDebug = () => {
    let n = 0, minY = 99, maxY = -99;
    for (let i = 0; i < SPRAY_N; i++) {
      const y = sprayPos[i * 3 + 1];
      if (y > 1.38) { n++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    return { n, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), visible: sprayPts.visible, matOpacity: sprayMat.opacity };
  };

  if (/auto|run/i.test(location.hash)) {
    setTimeout(() => act('start'), 500);
  }

  // initial
  updateCamera();
  drawHMI();
  refreshHUD();
  animate();
})();
