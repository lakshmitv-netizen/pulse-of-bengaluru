// NIGHT street sign, simulator build. Same look as the pitch board (one row of LED bars, one
// yellow at two intensities, a 2-LED white mark for people, a 4-LED white mark for vehicles), but the light comes from streetlights you can add / switch, and the parent page can
// send people, vehicles, a busy level and the time of day:
//   postMessage({ sim: 'night', cmd: 'person' | 'vehicle', dir: 1 | -1 })
//   postMessage({ sim: 'night', cmd: 'busy', value: 0..1 })
//   postMessage({ sim: 'night', cmd: 'hour', value: 6..24 })
//   postMessage({ sim: 'night', cmd: 'reset' })
//   postMessage({ sim: 'night', cmd: 'auto', value: false })   // stop the board making its own traffic
//   postMessage({ sim: 'night', cmd: 'person', dir: 1, cross: true }) // a person who walks the whole board
// Tap the strip to add a streetlight; tap a light (or its marker) to switch working -> failing -> off.
(() => {
  const strip = document.getElementById('night-strip');
  const W = 812, PITCH = 12, BAR_W = 4, BAR_H = 26;
  const N = Math.floor((W - 16 - BAR_W) / PITCH) + 1;
  const X0 = Math.round((W - ((N - 1) * PITCH + BAR_W)) / 2);
  const TOP = Math.round((56 - 2 - BAR_H) / 2);
  const YELLOW = [0xFF, 0xC2, 0x1A], OFF = [0x14, 0x19, 0x18], SHADOW = [0x0B, 0x0C, 0x0D], PERSON = [0xFF, 0xFF, 0xFF], CAR = [0xFF, 0xFF, 0xFF], CAR_LEN = 4;
  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- streetlights -> light along the street (two intensities, never pitch dark)
  const POWER = { on: 1, failing: 0.42, off: 0 }, REACH = 6.2;
  const defaultLamps = () => Array.from({ length: 8 }, (_, i) => ({ c: Math.round(4 + i * 8.4), state: i === 2 || i === 6 ? 'failing' : 'on' }));
  let lamps = defaultLamps(), daytime = false;
  let lux = [], base = [];
  const relight = () => {
    lux = [...Array(N)].map((_, c) => {
      if (daytime) return 1;
      let v = 0;
      for (const l of lamps) { const d = Math.abs(c - l.c); if (d < REACH) v = Math.max(v, POWER[l.state] * Math.cos((Math.PI / 2) * d / REACH) ** 2); }
      return v;
    });
    // two levels; a dim patch only shows as a real stretch (a failing or dead light), never a thin gap
    const lvl = lux.map(t => (t >= 0.5 ? 1 : 0.5)), MIN_DIM = 6;
    for (let i = 0; i < N;) {
      let j = i; while (j < N && lvl[j] === lvl[i]) j++;
      if (lvl[i] === 0.5 && j - i < MIN_DIM && i > 0 && j < N) for (let k = i; k < j; k++) lvl[k] = 1;
      i = j;
    }
    base = lvl.map(t => mix(OFF, YELLOW, t));
    drawMarkers();
  };

  const bars = [];
  for (let c = 0; c < N; c++) {
    const el = document.createElement('i');
    el.className = 'seg'; el.style.left = `${X0 + c * PITCH}px`; el.style.top = `${TOP}px`;
    bars.push(el); strip.appendChild(el);
  }

  // lamp markers under the strip (sim only)
  const rail = document.createElement('div');
  rail.className = 'lamp-rail';
  strip.parentElement.appendChild(rail);
  const css = document.createElement('style');
  css.textContent = `
    #night-strip { cursor: crosshair; }
    .lamp-rail { position: absolute; left: 59px; top: 346px; width: ${W}px; height: 26px; }
    .lamp-rail button { all: unset; cursor: pointer; position: absolute; top: 2px; width: 18px; height: 18px; margin-left: -7px; border-radius: 50%;
      box-shadow: 0 0 0 2px rgba(255,255,255,.9); transition: background .2s, box-shadow .2s; }
    .lamp-rail button.on { background: #FFC21A; box-shadow: 0 0 0 2px #fff, 0 0 10px 2px rgba(255,194,26,.8); }
    .lamp-rail button.failing { background: #7d5e10; }
    .lamp-rail button.off { background: #2a2a2a; box-shadow: 0 0 0 2px rgba(255,255,255,.55); }
    .lamp-rail.day button { opacity: .35; }`;
  document.head.appendChild(css);
  function drawMarkers() {
    rail.classList.toggle('day', daytime);
    rail.innerHTML = '';
    lamps.forEach((l, i) => {
      const b = document.createElement('button');
      b.className = l.state; b.style.left = `${X0 + l.c * PITCH + BAR_W / 2}px`;
      b.title = `Streetlight: ${l.state === 'on' ? 'working' : l.state} (click to change)`;
      b.onclick = (e) => { e.stopPropagation(); cycle(i); };
      rail.appendChild(b);
    });
  }
  const cycle = (i) => { const order = ['on', 'failing', 'off']; lamps[i].state = order[(order.indexOf(lamps[i].state) + 1) % 3]; relight(); };
  strip.addEventListener('click', (e) => {
    const r = strip.getBoundingClientRect(), z = r.width / W;
    const c = Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / z - X0) / PITCH)));
    const near = lamps.findIndex(l => Math.abs(l.c - c) <= 2);
    if (near >= 0) cycle(near); else { lamps.push({ c, state: 'on' }); relight(); }
  });

  // ---- movers
  let busy = 0.5;
  const rate = () => 0.15 + busy * 2.2;                       // how often new people / vehicles appear
  const movers = [], glints = [];
  let auto = true, lastDir = 1, nextAutoVehicle = rnd(4, 9), nextGlint = rnd(1, 3);
  const addVehicle = (dir) => {
    dir = dir || (lastDir = -lastDir);
    movers.push({ dir, x: dir > 0 ? -2 : N + 1, v: rnd(7, 12), a: 1 });
  };
  const addPerson = (dir, cross) => glints.push(cross
    ? { x: dir < 0 ? N + 3 : -3, dir: dir || 1, v: rnd(5, 6.5), age: 0, life: Infinity, cross: true }      // walks in at one end, out at the other
    : { x: rnd(4, N - 5), dir: dir || (Math.random() < 0.5 ? 1 : -1), v: rnd(0.6, 1.5), age: 0, life: rnd(3, 5.5) });

  addEventListener('message', (e) => {
    const d = e.data; if (!d || d.sim !== 'night') return;
    if (d.cmd === 'person') addPerson(d.dir, d.cross);
    if (d.cmd === 'auto') auto = !!d.value;
    if (d.cmd === 'vehicle') addVehicle(d.dir);
    if (d.cmd === 'busy') busy = Math.max(0, Math.min(1, +d.value));
    if (d.cmd === 'hour') { const h = +d.value; daytime = h >= 6.5 && h < 18.5; relight(); }
    if (d.cmd === 'reset') { lamps = defaultLamps(); movers.length = 0; glints.length = 0; relight(); }
  });

  relight();
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (auto && (nextAutoVehicle -= dt) <= 0) { addVehicle(); nextAutoVehicle = rnd(8, 18) / rate(); }
    if (auto && (nextGlint -= dt) <= 0) { addPerson(); nextGlint = rnd(3, 7) / rate(); }
    const lit = base.map(v => v.slice()), shadowAt = new Set(), personAt = new Map();
    for (let k = movers.length - 1; k >= 0; k--) {
      const m = movers[k]; m.x += m.dir * m.v * dt;
      if (m.x < -10 || m.x > N + 9) { movers.splice(k, 1); continue; }
      const head = Math.round(m.x);
      for (let i = 0; i < CAR_LEN; i++) { const c = head - i * m.dir; if (c >= 0 && c < N) shadowAt.add(c); }
    }
    for (let g = glints.length - 1; g >= 0; g--) {
      const q = glints[g]; q.age += dt; q.x += q.dir * q.v * dt;
      if (q.age > q.life || (q.cross && (q.x < -6 || q.x > N + 6))) { glints.splice(g, 1); continue; }
      const a = Math.min(1, q.age / 0.6, (q.life - q.age) / 1.0), head = Math.round(q.x);
      // a person is a 2-LED white mark, drawn like a vehicle's (fading in / out at the ends of a short walk)
      for (let i = 0; i < 2; i++) { const c = head - i * q.dir; if (c >= 0 && c < N) personAt.set(c, Math.max(personAt.get(c) || 0, a)); }
    }
    // people and vehicles both light up bright white (its headlight glow runs ahead of it)
    for (const [c, a] of personAt) if (!shadowAt.has(c)) lit[c] = mix(lit[c], PERSON, a);
    for (const c of shadowAt) lit[c] = mix(lit[c], CAR, 1);
    for (let c = 0; c < N; c++) { const s = `rgb(${lit[c]})`; if (bars[c]._c !== s) { bars[c].style.background = s; bars[c]._c = s; } }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
