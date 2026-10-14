/* Sekai landmarks — small cel-shaded 3D models standing on the shader globe.
   Placeholder models built from primitives; swap for .glb files later. */
(function () {
  let threeP = null;
  const loadThree = () => threeP || (threeP = import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'));
  const NAVY = 0x1f2657;

  function build(T) {
    const grad = new T.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, T.RGBAFormat);
    grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    const toon = (c, x) => new T.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, x || {}));
    const olMat = new T.MeshBasicMaterial({ color: NAVY, side: T.BackSide });
    const part = (grp, geo, mat, x, y, z, ol, rx, ry) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; grp.add(m);
      if (ol !== false) { const o = new T.Mesh(geo, olMat); o.position.copy(m.position); o.rotation.copy(m.rotation); o.scale.setScalar(ol || 1.08); grp.add(o); }
      return m; };

    const clock = new T.Group();
    part(clock, new T.BoxGeometry(.17, .035, .17), toon(0xd9cdb0), 0, .017, 0, 1.06);
    part(clock, new T.BoxGeometry(.11, .2, .11), toon(0xFFFEF0), 0, .135, 0, 1.06);
    for (let i = 0; i < 4; i++) {
      const f = new T.Group(); f.rotation.y = i * Math.PI / 2; clock.add(f);
      part(f, new T.CylinderGeometry(.038, .038, .012, 32), toon(0xFFFEF0), 0, .18, .058, 1.15, Math.PI / 2);
      part(f, new T.BoxGeometry(.006, .026, .004), new T.MeshBasicMaterial({ color: NAVY }), 0, .19, .066, false);
      part(f, new T.BoxGeometry(.02, .006, .004), new T.MeshBasicMaterial({ color: NAVY }), .008, .18, .066, false);
    }
    part(clock, new T.BoxGeometry(.036, .055, .01), toon(0x96C7FF, { emissive: 0x6fa8ff, emissiveIntensity: .7 }), 0, .062, .056, 1.12);
    part(clock, new T.ConeGeometry(.1, .12, 4), toon(0x96C7FF), 0, .295, 0, 1.06, 0, Math.PI / 4);
    part(clock, new T.SphereGeometry(.015, 16, 12), toon(0xF6C98E), 0, .362, 0, 1.2);

    const light = new T.Group();
    part(light, new T.CylinderGeometry(.12, .145, .045, 24), toon(0x6a75c0), 0, .022, 0, 1.05);
    const bands = 5, h0 = .045, h1 = .27, rb = .072, rt = .05;
    for (let i = 0; i < bands; i++) { const a = i / bands, b = (i + 1) / bands, y0 = h0 + (h1 - h0) * a, y1 = h0 + (h1 - h0) * b;
      part(light, new T.CylinderGeometry(rb + (rt - rb) * b, rb + (rt - rb) * a, y1 - y0, 32), toon(i % 2 ? 0xF6A5B8 : 0xFFFEF0), 0, (y0 + y1) / 2, 0, false); }
    { const o = new T.Mesh(new T.CylinderGeometry(rt, rb, h1 - h0, 32), olMat); o.position.y = (h0 + h1) / 2; o.scale.setScalar(1.06); light.add(o); }
    part(light, new T.CylinderGeometry(.078, .078, .014, 32), toon(0x46519a), 0, h1 + .007, 0, 1.06);
    part(light, new T.CylinderGeometry(.038, .038, .05, 20), toon(0xFFF3C4, { emissive: 0xF6C98E, emissiveIntensity: 1 }), 0, h1 + .04, 0, 1.08);
    part(light, new T.ConeGeometry(.056, .055, 24), toon(0xF6A5B8), 0, h1 + .092, 0, 1.08);
    const bg = new T.ConeGeometry(.1, .7, 24, 1, true); bg.translate(0, -.35, 0); bg.rotateZ(Math.PI / 2);
    const beamMat = new T.MeshBasicMaterial({ color: 0xFFF3C4, transparent: true, opacity: .28, depthWrite: false, side: T.DoubleSide });
    const beam = new T.Group(); beam.position.y = h1 + .04; light.add(beam);
    const b2 = new T.Mesh(bg, beamMat); b2.rotation.y = Math.PI; beam.add(new T.Mesh(bg, beamMat), b2);
    return { 3: clock, 8: light, beam };
  }

  function attach(el, cv, o) {
    return loadThree().then((T) => {
      const { ct, st, Rf, pins, maxPx } = o;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
      renderer.setClearColor(0x000000, 0);
      const c = renderer.domElement; c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:0';
      cv.insertAdjacentElement('afterend', c);
      const resize = () => { const d = Math.min(2, window.devicePixelRatio || 1), s = Math.min(maxPx || 2048, Math.max(1, Math.round(el.clientWidth * d))); renderer.setPixelRatio(1); renderer.setSize(s, s, false); };
      resize(); new ResizeObserver(resize).observe(el);
      const scene = new T.Scene(), h = 0.5 / Rf, cam = new T.OrthographicCamera(-h, h, h, -h, 0.1, 20); cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
      scene.add(new T.HemisphereLight(0xdfe4ff, 0x6a5fb0, 1.1));
      const sun = new T.DirectionalLight(0xffffff, 2.0); sun.position.set(-0.55, 0.45, 0.7); scene.add(sun);
      const occ = new T.Mesh(new T.SphereGeometry(0.998, 64, 48), new T.MeshBasicMaterial({ colorWrite: false })); scene.add(occ);
      const M = build(T), SCALE = o.scale || 0.45, marks = [];
      [3, 8].forEach(id => { const holder = new T.Group(), spin = new T.Group(); spin.rotation.y = 0.5; spin.add(M[id]); holder.add(spin); holder.scale.setScalar(SCALE); scene.add(holder); marks.push({ id, holder }); });
      const W = (rx, ry, nz) => new T.Vector3(rx * ct + ry * st, -(-rx * st + ry * ct), nz);
      const mtx = new T.Matrix4(), R = new T.Vector3();
      let last = performance.now();
      return {
        canvas: c,
        render(off) {
          const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now; M.beam.rotation.y += dt * .9;
          marks.forEach(({ id, holder }) => {
            const p = pins[id]; if (!p) { holder.visible = false; return; }
            const phi = (p.u - off - 0.5) * 2 * Math.PI, th = (p.v - 0.5) * Math.PI;
            const n = W(Math.cos(th) * Math.sin(phi), Math.sin(th), Math.cos(th) * Math.cos(phi)).normalize();
            const f = W(-Math.sin(th) * Math.sin(phi), Math.cos(th), -Math.sin(th) * Math.cos(phi)).normalize();
            R.crossVectors(n, f).normalize();
            const k = Math.max(0, Math.min(1, (n.z + 0.05) / 0.4)), e = k * k * (3 - 2 * k);
            holder.position.copy(n).multiplyScalar(0.996 - (1 - e) * 0.02);
            holder.scale.setScalar(SCALE * e);
            holder.quaternion.setFromRotationMatrix(mtx.makeBasis(R, n, f));
            holder.visible = e > 0.001;
          });
          renderer.render(scene, cam);
        }
      };
    });
  }
  window.SekaiLandmarks = { attach };
})();
