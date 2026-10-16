/* Sekai globe — placeholder planet (WebGL). Mounts on #lzGlobeGL (landing, spin only)
   and #wtGlobeGL (world page, clickable regions). Swap the generated maps for painted art later. */
(function () {
  const LM_SRC = (document.currentScript && document.currentScript.src || '').replace(/globe\.js(\?.*)?$/, 'landmarks.js');
  let lmP = null; const loadLM = () => lmP || (lmP = window.SekaiLandmarks ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = LM_SRC || 'assets/globe/landmarks.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }));
  const W = 1024, H = 512, N = W * H;
  const REGIONS = [
    { id: 1, name: 'Solo Play', u: 0.435, v: 0.40 },
    { id: 2, name: 'Multiplayer', u: 0.565, v: 0.37 },
    { id: 3, name: 'Daily Quiz', u: 0.50, v: 0.50 },
    { id: 4, name: 'Leaderboard', u: 0.435, v: 0.62 },
    { id: 5, name: 'Profile', u: 0.565, v: 0.61 },
    { id: 6, name: 'Library', u: 0.03, v: 0.42, isle: 1 },
    { id: 7, name: 'Credits', u: 0.92, v: 0.58, isle: 1 },
    { id: 8, name: 'About', u: 0.12, v: 0.63, isle: 1 },
  ];
  const LAYOUT = { 1: { dx: 4, dy: -17, rot: 165 }, 2: { dx: 20, dy: -31, rot: 105 }, 3: { dx: 1, dy: 4, rot: 120 }, 4: { dx: -15, dy: 31 }, 5: { dx: 22, dy: 19, rot: -30 } };
  const P = { ice: [255, 243, 221], edge: [236, 240, 255], sand: [178, 224, 204], l1: [138, 200, 182], l2: [112, 178, 166], l3: [246, 165, 184], shallow: [143, 178, 255], o1: [116, 132, 204], o3: [90, 102, 178], shadow: [72, 82, 152] };
  const JP = {
    hokkaido: [[141.9,45.5],[142.5,45.0],[143.5,44.2],[144.8,43.9],[145.3,43.4],[145.6,43.3],[144.3,42.9],[143.3,42.0],[141.8,42.6],[140.9,42.5],[140.0,41.5],[140.1,42.3],[139.8,42.6],[140.4,43.3],[141.4,43.3],[141.6,44.4]],
    shikoku: [[132.0,33.0],[132.5,33.9],[133.5,34.3],[134.6,34.2],[134.7,33.8],[134.2,33.3],[133.0,33.0],[132.5,32.8]],
    kyushu: [[129.8,33.4],[130.4,33.9],[131.0,33.9],[131.7,33.3],[131.9,32.6],[131.4,31.5],[131.0,31.0],[130.6,31.1],[130.2,31.3],[130.3,32.0],[130.0,32.8],[129.6,32.8]],
  };
  const ACTIONS = {
    1: () => window.choosePath && choosePath('solo'),
    2: () => window.choosePath && choosePath('multiplayer'),
    3: () => window.openDailyQuiz && openDailyQuiz(),
    4: () => window.goStep && goStep('leaderboard'),
    5: () => window.goProfile && goProfile(),
    6: () => window.openLibrary && openLibrary(),
  };

  function noise(seed, Pd) {
    const g = (i, j) => { i = ((i % Pd) + Pd) % Pd; let h = (i * 374761393 + j * 668265263 + seed * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
    return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  }
  function field(seed, base, oct) {
    const fs = []; for (let o = 0; o < oct; o++) fs.push([noise(seed + o * 17, base << o), base << o, 1 / (1 << o)]);
    const out = new Float32Array(N); let norm = 0; fs.forEach(f => norm += f[2]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (const [n, Pd, a] of fs) s += n(x / W * Pd, y / H * Pd / 2) * a; out[y * W + x] = s / norm; }
    return out;
  }
  const dist = (x, y, u, v) => { let du = Math.abs(x / W - u); du = Math.min(du, 1 - du); return Math.hypot(du * 2, y / H - v); };

  function genBase() {
    const e = field(7, 4, 5), w = field(33, 8, 3), hf = field(77, 16, 3), L = 0.53;
    const front = REGIONS.filter(r => !r.isle), isles = REGIONS.filter(r => r.isle);
    const region = new Uint8Array(N), land = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x;
      const du = Math.abs(x / W - 0.5), d0 = Math.hypot(du * 2 / 0.29, (y / H - 0.5) / 0.245), d = d0 + (w[i] - 0.5) * 0.9 + (hf[i] - 0.5) * 0.12;
      if (d0 < 1.9) {
        if (d >= 1) { e[i] = Math.min(e[i], 0.48); continue; }
        land[i] = 1; e[i] = 0.56 + (e[i] - 0.3) * 0.5;
        const wx = x + 22 * Math.sin(y / H * Math.PI * 4 + 1.3), wy = y + 16 * Math.sin(x / W * Math.PI * 6 + 0.7);
        let b = 9, b2 = 9, bid = 0;
        for (const r of front) { const dd = dist(wx, wy, r.u, r.v); if (dd < b) { b2 = b; b = dd; bid = r.id; } else if (dd < b2) b2 = dd; }
        if (b2 - b < 0.028) land[i] = 0; else region[i] = bid;
        continue;
      }
      e[i] -= 0.035;
      for (const r of isles) if (dist(x, y, r.u, r.v) < 0.22) e[i] = Math.min(e[i], 0.49);
      land[i] = e[i] > L ? 1 : 0;
    }
    // one piece per region
    const comp = new Int32Array(N).fill(-1), comps = [], best = {};
    for (let i = 0; i < N; i++) { if (!region[i] || comp[i] >= 0) continue; const id = region[i], c = comps.length, px = [i]; comp[i] = c;
      for (let k = 0; k < px.length; k++) { const p = px[k], x = p % W, y = (p / W) | 0;
        for (const q of [y * W + (x + 1) % W, y * W + (x - 1 + W) % W, p + W, p - W]) if (q >= 0 && q < N && comp[q] < 0 && region[q] === id) { comp[q] = c; px.push(q); } }
      comps.push({ id, px }); if (best[id] === undefined || px.length > comps[best[id]].px.length) best[id] = c; }
    comps.forEach((c, ci) => { if (best[c.id] !== ci) c.px.forEach(p => { region[p] = 0; land[p] = 0; }); });
    // far-side islets
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    [[6, JP.hokkaido, 0.9, -10], [7, JP.shikoku, 1.6, 15], [8, JP.kyushu, 1.45, -20]].forEach(([id, pts, sc, rot]) => { const r = REGIONS.find(q => q.id === id);
      let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
      for (const off of [-W, 0, W]) { g.save(); g.translate(r.u * W + off, r.v * H); g.rotate(rot * Math.PI / 180); g.scale(sc * 19, sc * 19); g.translate(-cx, cy);
        g.beginPath(); pts.forEach(([lo, la], k) => k ? g.lineTo(lo, -la) : g.moveTo(lo, -la)); g.closePath(); g.fillStyle = 'rgb(' + id * 20 + ',0,0)'; g.fill(); g.restore(); } });
    const mk = g.getImageData(0, 0, W, H).data;
    for (let i = 0; i < N; i++) if (mk[i * 4 + 3] > 120) { land[i] = 1; region[i] = Math.round(mk[i * 4] / 20); e[i] = Math.max(e[i], 0.6); }
    return { e, land, region };
  }

  function compose(b) {
    const acc = {};
    for (let i = 0; i < N; i++) { const id = b.region[i]; if (!id) continue; const x = i % W, y = (i / W) | 0;
      const a = acc[id] || (acc[id] = { ref: x, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, sx: 0, sy: 0, n: 0 });
      let ux = x - a.ref; if (ux > W / 2) ux -= W; else if (ux < -W / 2) ux += W; ux += a.ref;
      a.x0 = Math.min(a.x0, ux); a.x1 = Math.max(a.x1, ux); a.y0 = Math.min(a.y0, y); a.y1 = Math.max(a.y1, y); a.sx += ux; a.sy += y; a.n++; }
    const land = new Uint8Array(N), region = new Uint8Array(N), e = new Float32Array(b.e);
    for (let i = 0; i < N; i++) if (b.land[i] && !b.region[i]) land[i] = 1;
    for (const id in acc) { const A = acc[id], cx = A.sx / A.n, cy = A.sy / A.n, r = Math.hypot(Math.max(cx - A.x0, A.x1 - cx), Math.max(cy - A.y0, A.y1 - cy)) + 3;
      const t = LAYOUT[id] || {}, an = (t.rot || 0) * Math.PI / 180, ca = Math.cos(an), sa = Math.sin(an), tcx = cx + (t.dx || 0), tcy = cy + (t.dy || 0), nid = +id;
      for (let ty = Math.max(0, Math.floor(tcy - r)); ty <= Math.min(H - 1, Math.ceil(tcy + r)); ty++) for (let tx = Math.floor(tcx - r); tx <= Math.ceil(tcx + r); tx++) {
        const px = tx - tcx, py = ty - tcy, sx = Math.round(cx + px * ca + py * sa), sy = Math.round(cy - px * sa + py * ca);
        if (sy < 0 || sy >= H) continue; const si = sy * W + ((sx % W) + W) % W; if (b.region[si] !== nid) continue;
        const ti = ty * W + ((tx % W) + W) % W; land[ti] = 1; region[ti] = nid; e[ti] = b.e[si]; } }
    const cut = new Uint8Array(N);
    for (let y = 5; y < H - 5; y++) for (let x = 0; x < W; x++) { const i = y * W + x, r = region[i]; if (!r || r > 5) continue;
      for (const q of [y * W + (x + 5) % W, y * W + (x - 5 + W) % W, i + 5 * W, i - 5 * W]) if (region[q] && region[q] <= 5 && region[q] !== r) { cut[i] = 1; break; } }
    for (let i = 0; i < N; i++) if (cut[i]) { land[i] = 0; region[i] = 0; }
    return { e, land, region };
  }

  function blur(src, r, it) {
    const a = Float32Array.from(src), b = new Float32Array(N), k = 1 / (2 * r + 1);
    for (let n = 0; n < it; n++) {
      for (let y = 0; y < H; y++) { const o = y * W; let t = 0; for (let x = -r; x <= r; x++) t += a[o + ((x + W) % W)];
        for (let x = 0; x < W; x++) { b[o + x] = t * k; t += a[o + (x + r + 1) % W] - a[o + (x - r + W) % W]; } }
      for (let x = 0; x < W; x++) { let t = 0; for (let y = -r; y <= r; y++) t += b[Math.max(0, Math.min(H - 1, y)) * W + x];
        for (let y = 0; y < H; y++) { a[y * W + x] = t * k; t += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x]; } }
    }
    return a;
  }

  function puffs() {
    let sd = 1234567; const rnd = () => { sd = (sd + 0x6D2B79F5) | 0; let t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.fillStyle = '#fff';
    const K = 13;
    for (let k = 0; k < K; k++) { const cx = (k + 0.25 + rnd() * 0.5) / K * W, cy = H * ((k % 2 ? 0.58 : 0.32) + (rnd() - 0.5) * 0.2), sc = 15 + rnd() * 13, n = 2 + ((rnd() * 4) | 0);
      const lobes = []; let x = 0; for (let j = 0; j < n; j++) { const mid = 1 - Math.abs(j - (n - 1) / 2) / n; lobes.push([x, (0.45 - mid * 0.5) + (rnd() - 0.5) * 0.2, 0.55 + mid * 0.5 + rnd() * 0.25]); x += 1.0 + rnd() * 0.5; }
      const span = x - 1.0, f = 1.15 + rnd() * 0.5;
      for (const off of [-W, 0, W]) { g.beginPath(); const ox = cx + off - span * sc * f / 2;
        lobes.forEach(([dx, dy, r]) => { g.moveTo(ox + dx * sc * f + r * sc, cy + dy * sc); g.arc(ox + dx * sc * f, cy + dy * sc, r * sc, 0, Math.PI * 2); });
        g.rect(ox - 0.3 * sc, cy + 0.2 * sc, span * sc * f + 0.6 * sc, 0.6 * sc); g.fill(); } }
    const d = g.getImageData(0, 0, W, H).data, m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = d[i * 4 + 3] / 255;
    return blur(m, 2, 2);
  }
  let WORLD = null;
  function world() {
    if (WORLD) return WORLD;
    const { e, land, region } = compose(genBase()), lf = blur(land, 3, 2), sf = blur(land, 7, 2);
    const tex = new Uint8Array(N * 4), wat = new Uint8Array(N * 4), reg = new Uint8Array(N * 4), cl = new Uint8Array(N * 4), c = puffs();
    for (let y = 0; y < H; y++) { const lat = Math.abs(y / H - 0.5) * 2;
      for (let x = 0; x < W; x++) { const i = y * W + x, v = e[i], o = i * 4, lc = land[i] ? (v < 0.66 ? P.l1 : v < 0.78 ? P.l2 : P.l3) : P.l1;
        tex[o] = lc[0]; tex[o + 1] = lc[1]; tex[o + 2] = lc[2]; tex[o + 3] = Math.round(lf[i] * 255);
        wat[o] = Math.round(sf[i] * 255); wat[o + 1] = Math.round(Math.max(0, Math.min(1, (v - 0.38) / 0.14)) * 255); wat[o + 2] = lat > 0.9 - Math.min(v, 0.6) * 0.15 ? 255 : 0; wat[o + 3] = 255;
        reg[o + 3] = region[i];
        cl[o] = cl[o + 1] = cl[o + 2] = 255; cl[o + 3] = Math.round(c[i] * 255); } }
    const acc = {}; for (let i = 0; i < N; i++) { const id = region[i]; if (!id) continue; const a = acc[id] || (acc[id] = [0, 0, 0, 0]), ang = (i % W) / W * 2 * Math.PI; a[0] += Math.cos(ang); a[1] += Math.sin(ang); a[2] += (i / W) | 0; a[3]++; }
    const pins = {}; for (const id in acc) { const a = acc[id]; pins[id] = { u: (Math.atan2(a[1], a[0]) / (2 * Math.PI) + 1) % 1, v: a[2] / a[3] / H }; }
    return (WORLD = { tex, wat, reg, cl, region, pins });
  }

  const FS = `precision highp float;
uniform sampler2D uTex,uCloud,uReg,uWater;uniform vec3 cEdge,cSand,cShallow,cO1,cO3,cShadow,cIce;uniform float uOff,uCOff,uCt,uSt,uHover,uSize,uCel,uLine;
void main(){
 float R=uSize*0.5/1.12; vec2 n=(gl_FragCoord.xy-uSize*0.5)/R; n.y=-n.y;
 float r2=dot(n,n);
 if(uCel>0.5&&r2>1.0){ float rr=sqrt(r2); if(rr>1.0+uLine*0.5) discard; gl_FragColor=vec4(0.12,0.14,0.33,1.0-smoothstep(1.0+uLine*0.3,1.0+uLine*0.5,rr)); return; }
 if(r2>1.0){ float rr=sqrt(r2); if(rr>1.12) discard; float ha=pow(1.0-(rr-1.0)/0.12,2.0)*0.12; gl_FragColor=vec4(0.74,0.82,1.0,ha); return; }
 float nz=sqrt(1.0-r2); float rx=n.x*uCt-n.y*uSt; float ry=n.x*uSt+n.y*uCt;
 float lon=atan(rx,nz)/6.2831853+0.5; float v=asin(clamp(ry,-1.,1.))/3.1415927+0.5;
 vec2 uv=vec2(fract(lon+uOff),v);
 float reg=floor(texture2D(uReg,uv).a*255.0+0.5);
 vec4 T=texture2D(uTex,uv); vec4 Wt=texture2D(uWater,uv); float m=T.a;
 if(uCel>0.5){
  vec3 ink=vec3(0.12,0.14,0.33); float cv=reg>0.5?0.2:1.0;
  vec3 w=mix(cO3,cO1,smoothstep(0.47,0.53,Wt.g)); w=mix(w,cShallow,smoothstep(0.19,0.23,Wt.r));
  vec3 c=mix(w,T.rgb,smoothstep(0.5,0.54,m)); c=mix(c,cIce,step(0.5,Wt.b));
  c=mix(c,ink,smoothstep(0.40,0.44,m)*(1.0-smoothstep(0.54,0.58,m))*0.85);
  if(uHover>0.5&&abs(reg-uHover)<0.5) c=mix(c,vec3(1.0,0.96,0.75),0.35);
  vec2 cu=vec2(fract(lon+uOff+uCOff),v);
  float csd=texture2D(uCloud,vec2(cu.x-0.006,v-0.016)).a; c*=mix(vec3(1.0),vec3(0.72,0.72,0.92),smoothstep(0.48,0.52,csd)*cv);
  float ca=texture2D(uCloud,cu).a; float cbl=texture2D(uCloud,vec2(cu.x,v+0.016)).a;
  vec3 cc=mix(vec3(1.0),vec3(0.78,0.81,0.96),1.0-smoothstep(0.48,0.52,cbl));
  cc=mix(ink,cc,smoothstep(0.56,0.6,ca));
  c=mix(c,cc,smoothstep(0.42,0.46,ca)*cv);
  float nz=sqrt(1.0-r2); vec3 N=vec3(n,nz); float l=dot(N,normalize(vec3(-0.55,-0.45,0.7)));
  float s1=smoothstep(0.08,0.12,l), s2=smoothstep(-0.42,-0.38,l);
  c*=mix(mix(vec3(0.5,0.48,0.8),vec3(0.76,0.74,0.96),s2),vec3(1.0),s1);
  
  if(uLine>0.0) c=mix(c,ink,smoothstep(1.0-uLine*2.2,1.0-uLine*1.8,r2));
  gl_FragColor=vec4(min(c,1.0),uLine>0.0?1.0:1.0-smoothstep(0.985,1.0,r2)); return; }
 vec3 water=mix(cO3,cO1,Wt.g); water=mix(water,cShallow,smoothstep(0.06,0.3,Wt.r));
 float sd=texture2D(uTex,vec2(fract(lon+uOff-0.003),v-0.008)).a; water=mix(water,cShadow,smoothstep(0.45,0.55,sd)*0.85);
 vec3 lc=mix(cSand,T.rgb,smoothstep(0.84,0.9,m)); lc=mix(cEdge,lc,smoothstep(0.68,0.74,m));
 vec3 col=mix(water,lc,smoothstep(0.47,0.53,m)); col=mix(col,cIce,Wt.b);
 if(uHover>0.5&&abs(reg-uHover)<0.5) col=mix(col,vec3(1.0,0.96,0.75),0.32);
 vec2 cu=vec2(fract(lon+uOff+uCOff),v);
 float csd=texture2D(uCloud,vec2(cu.x-0.006,v-0.014)).a; col*=1.0-0.3*smoothstep(0.48,0.52,csd)*(reg>0.5?0.3:1.0);
 float ca=texture2D(uCloud,cu).a; float cbl=texture2D(uCloud,vec2(cu.x,v+0.014)).a;
 vec3 cc=mix(vec3(0.42,0.48,0.75),vec3(1.0),smoothstep(0.53,0.58,ca));
 cc=mix(cc,vec3(0.80,0.84,0.96),(1.0-smoothstep(0.46,0.54,cbl))*smoothstep(0.57,0.6,ca));
 col=mix(col,cc,smoothstep(0.48,0.52,ca)*(reg>0.5?0.2:1.0));
 vec3 Ld=normalize(vec3(-0.55,-0.45,0.7)); float l=dot(vec3(n,nz),Ld);
 col*=mix(vec3(0.5,0.48,0.8),vec3(1.04),smoothstep(-0.35,0.65,l));
 float edgeF=1.0-nz;
 col+=vec3(1.0,0.74,0.64)*pow(edgeF,2.2)*smoothstep(0.1,0.95,n.y)*0.45;
 col=mix(col,vec3(0.76,0.83,1.0),pow(edgeF,3.5)*0.25);
 gl_FragColor=vec4(min(col,1.0),1.0);
}`;

  function toast(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:99999;padding:12px 20px;border-radius:14px;background:#27306c;border:2px solid #8fb2ff;color:#EEEFF6;font:800 14px 'Nunito',sans-serif;box-shadow:0 4px 0 #1a2050;pointer-events:none;transition:opacity .4s";
    document.body.appendChild(t); setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 1800);
  }

  function mount(el, opt) {
    const interactive = !!opt.interactive, tilt = 18 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:50%;opacity:0;transition:opacity .6s;' + (interactive ? 'cursor:grab;touch-action:none;' : 'pointer-events:none;');
    el.appendChild(cv);
    const gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false, alpha: true });
    if (!gl) { cv.remove(); return null; }
    const Wd = world();
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {}; ['uTex', 'uCloud', 'uReg', 'uWater', 'cEdge', 'cSand', 'cShallow', 'cO1', 'cO3', 'cShadow', 'cIce', 'uOff', 'uCOff', 'uCt', 'uSt', 'uHover', 'uSize', 'uCel', 'uLine'].forEach(k => u[k] = gl.getUniformLocation(pr, k));
    [[0, Wd.tex, gl.LINEAR, 'uTex'], [1, Wd.cl, gl.LINEAR, 'uCloud'], [2, Wd.reg, gl.NEAREST, 'uReg'], [3, Wd.wat, gl.LINEAR, 'uWater']].forEach(([unit, data, f, name]) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(u[name], unit); });
    [['cEdge', 'edge'], ['cSand', 'sand'], ['cShallow', 'shallow'], ['cO1', 'o1'], ['cO3', 'o3'], ['cShadow', 'shadow'], ['cIce', 'ice']].forEach(([k, n]) => gl.uniform3f(u[k], P[n][0] / 255, P[n][1] / 255, P[n][2] / 255));
    gl.uniform1f(u.uCt, ct); gl.uniform1f(u.uSt, st);
    let style = 'cel'; try { style = new URLSearchParams(location.search).get('globe') || localStorage.getItem('sekai_globe_style') || 'cel'; } catch (_) {}
    gl.uniform1f(u.uCel, style === 'soft' ? 0 : 1); gl.uniform1f(u.uLine, opt.line || 0);

    let actF = opt.active !== false ? 1 : 0, actAt = 0, active = opt.active !== false, off = interactive ? 0 : 0.35, cOff = 0, hover = 0, drag = null, tw = null, visible = true, last = performance.now(), raf;
    const resize = () => { const d = Math.min(2, window.devicePixelRatio || 1), s = Math.min(opt.maxPx || 4096, Math.max(1, Math.round(el.clientWidth * d))); if (cv.width !== s) { cv.width = cv.height = s; gl.viewport(0, 0, s, s); gl.uniform1f(u.uSize, s); } };
    resize(); new ResizeObserver(resize).observe(el);
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(el);

    const Rf = 0.5 / 1.12;
    const project = (pu, pv) => { let phi = ((pu - off - 0.5) % 1 + 1.5) % 1 - 0.5; phi *= 2 * Math.PI;
      const th = (pv - 0.5) * Math.PI, rx = Math.cos(th) * Math.sin(phi), nz = Math.cos(th) * Math.cos(phi), ry = Math.sin(th);
      return { x: 0.5 + (rx * ct + ry * st) * Rf, y: 0.5 + (-rx * st + ry * ct) * Rf, z: nz }; };
    const hit = (ev) => { const r = cv.getBoundingClientRect(), nx = ((ev.clientX - r.left) / r.width - 0.5) / Rf, ny = ((ev.clientY - r.top) / r.height - 0.5) / Rf, r2 = nx * nx + ny * ny; if (r2 > 1) return 0;
      const nz = Math.sqrt(1 - r2), rx = nx * ct - ny * st, ry = nx * st + ny * ct;
      const tu = ((Math.atan2(rx, nz) / (2 * Math.PI) + 0.5 + off) % 1 + 1) % 1, tv = Math.asin(Math.max(-1, Math.min(1, ry))) / Math.PI + 0.5;
      return Wd.region[Math.min(H - 1, (tv * H) | 0) * W + ((tu * W) | 0)]; };
    let lm = null; if (interactive) loadLM().then(() => window.SekaiLandmarks.attach(el, cv, { ct, st, Rf, ct, st, pins: Object.fromEntries(REGIONS.map(r => [r.id, Wd.pins[r.id] || r])), maxPx: opt.maxPx || 2048 })).then(x => { lm = x; }).catch(e => console.warn('landmarks', e));
    const tweenTo = (target, dur, done) => { const d = ((target - off) % 1 + 1.5) % 1 - 0.5; tw = { from: off, d, t0: performance.now(), dur, done }; };

    let pinsEl = null;
    let leaving = null, zoomBack = false;
    const stg = el.closest('.wt-stage');
    const veil = () => { let v = document.getElementById('sekaiVeil'); if (!v) { v = document.createElement('div'); v.id = 'sekaiVeil'; v.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:0;background:var(--bg,#1f2462)'; document.body.appendChild(v); } return v; };
    const finish = () => { if (!leaving) return; const L = leaving; leaving = null; clearTimeout(L.t1); clearTimeout(L.t2); clearTimeout(L.t3); tw = null; off = L.to;
      const v = veil(); v.style.transition = 'none'; v.style.opacity = '1'; v.style.pointerEvents = 'auto'; zoomBack = true;
      try { ACTIONS[L.id](); } catch (e) { console.error(e); }
      requestAnimationFrame(() => requestAnimationFrame(() => { v.style.transition = 'opacity .6s ease'; v.style.opacity = '0'; v.style.pointerEvents = 'none'; })); };
    const pick = (id) => { if (leaving) { finish(); return; } if (tw) return; const r = REGIONS.find(q => q.id === id), pp = Wd.pins[id] || r;
      if (!ACTIONS[id]) { tweenTo(pp.u - 0.5, 650, () => toast(r.name + ' — coming soon')); return; }
      let to = pp.u - 0.5, d = ((to - off) % 1 + 1.5) % 1 - 0.5; to = off + d;
      leaving = { id, to: ((to % 1) + 1) % 1 }; hover = id;
      const v = veil();
      if (reduced || !stg) { v.style.transition = 'opacity .4s ease'; v.style.pointerEvents = 'auto'; v.style.opacity = '1'; leaving.t2 = setTimeout(finish, 420); return; }
      tweenTo(to, 700);
      leaving.t1 = setTimeout(() => stg.classList.add('wt-leave'), 550);
      leaving.t3 = setTimeout(() => { v.style.transition = 'opacity .6s ease'; v.style.pointerEvents = 'auto'; v.style.opacity = '1'; }, 550 + 1300);
      leaving.t2 = setTimeout(finish, 550 + 1300 + 620); };
    if (interactive) {
      pinsEl = document.createElement('div'); pinsEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;'; el.appendChild(pinsEl);
      REGIONS.forEach(r => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', r.name);
        b.style.cssText = "position:absolute;left:0;top:0;opacity:0;padding:0;border:0;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transform:translate(-50%,calc(-100% + 5px))" + (opt.pinScale ? " scale(" + opt.pinScale + ")" : "") + ";transform-origin:50% 100%;font-family:'Lilita One',cursive;font-size:12px;color:#1f2657;";
        b.innerHTML = '<span style="background:#fffaf0;border:2px solid #1f2657;border-radius:999px;padding:3px 9px;white-space:nowrap;box-shadow:0 2px 0 #1f2657;transform-origin:50% 100%;transition:transform .18s cubic-bezier(.3,1.6,.5,1)">' + r.name + '</span><span style="width:7px;height:7px;border-radius:50%;background:#F6C98E;border:2px solid #1f2657"></span>';
        b.addEventListener('pointerenter', () => hover = r.id); b.addEventListener('pointerleave', () => { if (hover === r.id) hover = 0; });
        b.addEventListener('click', (ev) => { ev.stopPropagation(); pick(r.id); });
        pinsEl.appendChild(b); });
      cv.addEventListener('pointerdown', (ev) => { if (!active) return; try { cv.setPointerCapture(ev.pointerId); } catch (_) {} drag = { x: ev.clientX, off, moved: false }; window.dispatchEvent(new Event('sekai-globe-drag')); cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', (ev) => {
        if (drag) { const dx = ev.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; if (drag.moved) { off = drag.off - dx / (Math.PI * cv.getBoundingClientRect().width); tw = null; } }
        else if (active) { hover = hit(ev); cv.style.cursor = hover ? 'pointer' : 'grab'; } });
      cv.addEventListener('pointerup', (ev) => { const d = drag; drag = null; cv.style.cursor = 'grab'; if (d && !d.moved) { const id = hit(ev); if (id) pick(id); } });
      cv.addEventListener('pointerleave', () => { if (!drag) hover = 0; });
    }

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (document.hidden || !visible) return;
      if (tw) { const k = Math.min(1, (now - tw.t0) / tw.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; off = tw.from + tw.d * e; if (k >= 1) { const cb = tw.done; tw = null; cb && cb(); } }
      else if (!interactive && !reduced) off += dt * 0.006;
      if (!reduced) cOff += dt * 0.003;
      off = ((off % 1) + 1) % 1;
      actF = active ? (now > actAt ? Math.min(1, actF + dt * 0.85) : actF) : Math.max(0, actF - dt * 4);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.uOff, off); gl.uniform1f(u.uCOff, cOff + 0.37); gl.uniform1f(u.uHover, interactive ? hover : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (lm) { lm.canvas.style.opacity = (actF * actF * (3 - 2 * actF)).toFixed(3); lm.render(off); }
      if (zoomBack && !leaving && el.getClientRects().length && stg) { zoomBack = false; setTimeout(() => stg.classList.remove('wt-leave'), 350); }
      if (pinsEl) REGIONS.forEach((r, i) => { const b = pinsEl.children[i], pp = Wd.pins[r.id] || r, p = project(pp.u, pp.v), vis = active && p.z > 0.25;
        b.style.left = (p.x * 100) + '%'; b.style.top = (p.y * 100) + '%'; b.style.zIndex = hover === r.id ? 2 : 1;
        b.firstChild.style.transform = hover === r.id ? 'scale(1.35)' : 'scale(1)';
        b.style.opacity = vis ? Math.min(1, (p.z - 0.25) * 4) * actF * actF * (3 - 2 * actF) : 0; b.style.pointerEvents = vis ? 'auto' : 'none'; });
    };
    loop();
    requestAnimationFrame(() => { cv.style.opacity = '1'; opt.onReady && opt.onReady(); });
    return { home: () => tweenTo(0, 900), spinTo: (t, dur, done) => { if (reduced) { off = t; done && done(); } else tweenTo(t, dur, done); }, setOff: (v) => { tw = null; off = v; }, getCloud: () => cOff, setCloud: (v) => { cOff = v; }, setActive: (v) => { if (v && !active) actAt = performance.now() + (window._wtFlying ? 500 : 250); active = !!v; if (!active) { hover = 0; drag = null; } } };
  }

  // Landing globe: this script loads right after the landing markup, so mount it straight away.
  // #lzGlobeBall is a still of this exact first frame (embedded in index.html's CSS): it stays fully visible
  // while the canvas fades in on top of it, then hides, so the handoff can't be seen.
  const land = document.getElementById('lzGlobeGL');
  if (land) window.sekaiLandGlobe = mount(land, { onReady: () => { const b = document.getElementById('lzGlobeBall'); if (b) { b.style.transition = 'opacity .2s .7s'; b.style.opacity = '0'; } } });

  function boot() {
    const wt = document.getElementById('wtGlobeGL'), tp = document.getElementById('wtPlanetGL');
    if (!wt && !tp) return;
    setTimeout(() => {
      if (tp) { const st = document.getElementById('wtStage'); window.sekaiTourGlobe = mount(tp, { interactive: true, maxPx: 2048, pinScale: (1 / 0.2417).toFixed(3), active: !!st && st.dataset.step === '6' }); }
      if (wt) window.sekaiWorldGlobe = mount(wt, { interactive: true });
    }, 60);
  }
  window.SekaiGlobe = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
