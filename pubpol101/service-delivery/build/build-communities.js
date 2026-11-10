// Build data for the Public Service Delivery Exercise (four Seattle communities).
// Usage: node build-communities.js <raw dir> <out dir>
// Each community folder in <raw dir> holds: osm.json (walkable ways), tracts.geojson (City of Seattle RSE index),
// dests.json (OpenStreetMap service locations). Output: <out dir>/data-<id>.js, each defining COMMUNITY_DATA["<id>"].
const fs = require("fs"), path = require("path");
const RAW = process.argv[2], OUT = process.argv[3];
const WALK_M = 800, PAIR_MAX = 2600, LOCAL_PENALTY = 1.6, STOP_SPACING = 700, MAX_STOPS = 28, SNAP_MAX = 150;
// Corridor stations (v2, 10 Nov 2026): every named arterial gets a candidate about every CORR_TARGET m, so any corridor a
// bus could plausibly run along can meet the 400 m - 2 km spacing rule. OLD=1 reproduces the v1 selection for comparison.
const CORR_MIN_LEN = 1200, CORR_LO = 650, CORR_TARGET = 1000, CORR_HI = 1300, MERGE_M = 450, DUP_M = 150, ON_M = 150;
const OLD = process.env.OLD === "1";

const COMMUNITIES = [
  { id: "north", name: "North of the Ship Canal", short: "Ballard to the University District",
    bbox: { w: -122.410, e: -122.285, s: 47.645, n: 47.693 },
    // Ship Canal / Lake Union / Portage Bay line (lon, lat), west to east; only streets north of it are kept
    southLine: [[-122.420, 47.6660], [-122.3975, 47.6653], [-122.385, 47.6612], [-122.376, 47.6592], [-122.365, 47.6560], [-122.3505, 47.6492],
      [-122.3405, 47.6466], [-122.335, 47.6457], [-122.3255, 47.6478], [-122.3205, 47.6527], [-122.310, 47.6507], [-122.304, 47.6478], [-122.280, 47.6480]],
    labels: [["Ballard", -122.3840, 47.6712], ["Fremont", -122.3500, 47.6525], ["Wallingford", -122.3345, 47.6610], ["Green Lake", -122.3390, 47.6800],
      ["Phinney Ridge", -122.3545, 47.6720], ["Roosevelt", -122.3165, 47.6775], ["University District", -122.3130, 47.6630], ["Crown Hill", -122.3760, 47.6890]] },
  { id: "southeast", name: "Southeast Seattle", short: "Beacon Hill and the Rainier Valley",
    bbox: { w: -122.325, e: -122.255, s: 47.497, n: 47.592 },
    labels: [["Beacon Hill", -122.3110, 47.5700], ["Mount Baker", -122.2900, 47.5780], ["Columbia City", -122.2850, 47.5590], ["Othello", -122.2810, 47.5380],
      ["Rainier Beach", -122.2690, 47.5180], ["Rainier Valley", -122.2900, 47.5470], ["Georgetown", -122.3220, 47.5450]] },
  { id: "west", name: "West Seattle and Delridge", short: "Alki to Highland Park",
    bbox: { w: -122.420, e: -122.348, s: 47.514, n: 47.585 },
    labels: [["Admiral", -122.3870, 47.5770], ["Alki", -122.4080, 47.5790], ["Junction", -122.3870, 47.5610], ["Delridge", -122.3630, 47.5500],
      ["High Point", -122.3730, 47.5450], ["Highland Park", -122.3480, 47.5250], ["Fauntleroy", -122.3890, 47.5240]] },
  { id: "northseattle", name: "North Seattle", short: "Bitter Lake, Northgate, and Lake City",
    bbox: { w: -122.370, e: -122.270, s: 47.690, n: 47.735 },
    labels: [["Bitter Lake", -122.3470, 47.7230], ["Broadview", -122.3610, 47.7220], ["Licton Springs", -122.3420, 47.6990], ["Northgate", -122.3250, 47.7060],
      ["Lake City", -122.2930, 47.7190], ["Pinehurst", -122.3150, 47.7230], ["Maple Leaf", -122.3170, 47.6950]] }
];

// ---- helpers ------------------------------------------------------------------------------
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
const KIND = h => /^(primary|secondary|trunk)(_link)?$/.test(h) ? 2 : /^(tertiary|tertiary_link|residential|unclassified|living_street)$/.test(h) ? 1 : 0;
const ART = h => /^(primary|secondary|trunk|tertiary)$/.test(h);
const ABBR = { North: "N", South: "S", East: "E", West: "W", Northeast: "NE", Northwest: "NW", Southeast: "SE", Southwest: "SW",
  Street: "St", Avenue: "Ave", Boulevard: "Blvd", Place: "Pl", Drive: "Dr", Road: "Rd", Way: "Way", Parkway: "Pkwy", Court: "Ct", Lane: "Ln", Terrace: "Ter" };
const abbr = n => n.split(" ").map(w => ABBR[w] || w).join(" ");
function heapPush(heap, d, n) { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } }
function heapPop(heap) { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; }
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > maxD) { maxD = d; idx = i; } }
  if (maxD <= tol) return [a, b];
  return dp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(dp(pts.slice(idx), tol));
}
function dpRing(pts, tol) { if (pts.length < 5) return pts; let far = 1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
  return dp(pts.slice(0, far + 1), tol).slice(0, -1).concat(dp(pts.slice(far), tol)); }
function pip(pt, polys) { let inside = false;
  for (const poly of polys) { let inPoly = false;
    for (let r = 0; r < poly.length; r++) { const ring = poly[r]; let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; }
      if (r === 0) inPoly = c; else if (c) inPoly = false; }
    if (inPoly) inside = true; }
  return inside; }
function destCategory(t) {
  const name = t.name || "";
  if (t.amenity === "food_bank" || t.social_facility === "food_bank" || (t.amenity === "social_facility" && /food|pantry|meal/i.test(name))) return "food";
  if (t.amenity === "clinic" || t.healthcare === "clinic" || t.healthcare === "centre") return "health";
  if (t.amenity === "library" || t.amenity === "community_centre") return "civic";
  return null; // other social facilities (shelters, assisted living) are left out on purpose
}

function build(C) {
  const dir = path.join(RAW, C.id), B = C.bbox;
  const LAT0 = (B.n + B.s) / 2, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111320;
  const proj = (lon, lat) => [Math.round((lon - B.w) * KX), Math.round((B.n - lat) * KY)];
  const lineLat = lon => { const L = C.southLine; for (let i = 1; i < L.length; i++) if (lon <= L[i][0]) { const [x0, y0] = L[i - 1], [x1, y1] = L[i]; return y0 + (y1 - y0) * (lon - x0) / (x1 - x0); } return L[L.length - 1][1]; };
  const inStudy = (lon, lat) => lon >= B.w && lon <= B.e && lat >= B.s && lat <= B.n && (!C.southLine || lat > lineLat(lon) + 0.0002);

  const osm = JSON.parse(fs.readFileSync(path.join(dir, "osm.json"), "utf8"));
  const coord = new Map(); for (const e of osm.elements) if (e.type === "node") coord.set(e.id, [e.lon, e.lat]);
  const ways = osm.elements.filter(e => e.type === "way");
  const adj = new Map(), artNames = new Map(), streetNames = new Map();
  const addEdge = (a, b, len, kind) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push({ to: b, len, kind }); adj.get(b).push({ to: a, len, kind }); };
  for (const w of ways) {
    const kind = KIND(w.tags.highway), art = ART(w.tags.highway) && w.tags.name, rank = /^(primary|secondary|trunk)$/.test(w.tags.highway) ? 2 : 1;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i], c = coord.get(id); if (!c || !inStudy(c[0], c[1])) continue;
      if (art) { if (!artNames.has(id)) artNames.set(id, new Map()); const m = artNames.get(id); m.set(w.tags.name, Math.max(m.get(w.tags.name) || 0, rank)); }
      // every named street a bus could use, for labeling corridor stations at local cross streets (rank 0)
      if (kind >= 1 && w.tags.name) { if (!streetNames.has(id)) streetNames.set(id, new Map()); const m = streetNames.get(id); m.set(w.tags.name, Math.max(m.get(w.tags.name) || 0, art ? rank : 0)); }
      if (i === 0) continue;
      const pid = w.nodes[i - 1], pc = coord.get(pid); if (!pc || !inStudy(pc[0], pc[1])) continue;
      if (pid !== id) addEdge(pid, id, hav(pc, c), kind);
    }
  }
  // largest connected component
  const comp = new Map(); let best = null, bestSize = 0;
  for (const s of adj.keys()) { if (comp.has(s)) continue; const st = [s], mem = []; comp.set(s, s);
    while (st.length) { const u = st.pop(); mem.push(u); for (const e of adj.get(u)) if (!comp.has(e.to)) { comp.set(e.to, s); st.push(e.to); } }
    if (mem.length > bestSize) { bestSize = mem.length; best = s; } }
  for (const id of [...adj.keys()]) if (comp.get(id) !== best) adj.delete(id);
  for (const [id, list] of adj) adj.set(id, list.filter(e => adj.has(e.to)));

  // tracts (center in study area), residents spread along residential streets
  const tj = JSON.parse(fs.readFileSync(path.join(dir, "tracts.geojson"), "utf8"));
  const rings = g => g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  const centroid = polys => { let sx = 0, sy = 0, n = 0; for (const p of polys) for (const [x, y] of p[0]) { sx += x; sy += y; n++; } return [sx / n, sy / n]; };
  const tracts = tj.features.map(f => ({ geoid: f.properties.GEOID, name: f.properties.NAME, pop: f.properties.POP_TOTAL_FOR_POC || 0, poc: f.properties.POP_POC || 0,
    low: f.properties.POP_UNDER200PCT_POVERTY || 0, povBase: f.properties.POP_POV_STATUS_DETERMINED || 0, polys: rings(f.geometry) }))
    .filter(t => { const c = centroid(t.polys); return inStudy(c[0], c[1]); });
  const tractDensity = tracts.map(t => { let a = 0; for (const p of t.polys) { const r = p[0]; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * KX) * (r[i][1] * KY) - (r[i][0] * KX) * (r[j][1] * KY); } return t.pop / (Math.abs(a) / 2 / 4046.86 || 1); });
  const densityAt = c => { const i = tracts.findIndex(t => pip(c, t.polys)); return i < 0 ? 0 : tractDensity[i]; };
  // same street under two names (e.g., "NW Leary Way" and "Leary Way NW") is not an intersection
  const core = n => n.split(" ").filter(w => !/^(N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest|Street|Avenue|Way|Place|Boulevard|Drive|Road)$/.test(w)).join(" ");
  // candidate stations: arterial-arterial intersections, strongest first, thinned to STOP_SPACING
  const cands = [];
  for (const [id, m] of artNames) { if (!adj.has(id) || m.size < 2) continue;
    const names = [...m.entries()].sort((a, b) => b[1] - a[1]).filter((n, i, arr) => arr.findIndex(o => core(o[0]) === core(n[0])) === i);
    if (names.length < 2) continue;
    const c = coord.get(id), score = names.slice(0, 2).reduce((s, n) => s + n[1], 0) * 1000 + densityAt(c);
    cands.push({ id, score, label: abbr(names[0][0]) + " & " + abbr(names[1][0]), c }); }
  cands.sort((a, b) => b.score - a.score || a.id - b.id);

  // corridors: named arterials, one per street (direction suffixes kept, so 15th Ave NW and 15th Ave NE stay apart),
  // each reduced to its longest connected run through the street network
  const DIRS = /^(N|S|E|W|NE|NW|SE|SW)$/;
  const corrKey = n => core(n) + "|" + n.split(" ").filter(w => DIRS.test(w)).sort().join("");
  const corrAdj = new Map(), corrName = new Map();
  for (const w of ways) { if (!ART(w.tags.highway) || !w.tags.name) continue; const k = corrKey(w.tags.name);
    if (!corrAdj.has(k)) { corrAdj.set(k, new Map()); corrName.set(k, w.tags.name); } const g = corrAdj.get(k);
    for (let i = 1; i < w.nodes.length; i++) { const a = w.nodes[i - 1], b = w.nodes[i]; if (!adj.has(a) || !adj.has(b)) continue; const d = hav(coord.get(a), coord.get(b));
      if (!g.has(a)) g.set(a, []); if (!g.has(b)) g.set(b, []); g.get(a).push([b, d]); g.get(b).push([a, d]); } }
  function farthest(g, src) { const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
    while (heap.length) { const [d, u] = heapPop(heap); if (d > dist.get(u)) continue; for (const [v, len] of g.get(u)) { const nd = d + len; if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, u); heapPush(heap, nd, v); } } }
    let far = src, fd = 0; for (const [n, d] of dist) if (d > fd) { fd = d; far = n; } return { far, fd, prev, dist }; }
  const corridors = [];
  for (const [k, g] of corrAdj) { const seen = new Set();
    for (const start of g.keys()) { if (seen.has(start)) continue;
      const a = farthest(g, start); for (const n of a.dist.keys()) seen.add(n);
      const b = farthest(g, a.far); if (b.fd < CORR_MIN_LEN) continue;
      const nodes = []; let n = b.far; while (n !== undefined) { nodes.push(n); n = b.prev.get(n); }
      corridors.push({ key: k, name: abbr(corrName.get(k)), len: b.fd, nodes, s: nodes.map(x => b.fd - b.dist.get(x)) }); } }

  let stopNodes = [];
  if (OLD) {
    for (const c of cands) { if (stopNodes.length >= MAX_STOPS) break; if (stopNodes.some(s => hav(s.c, c.c) < STOP_SPACING)) continue; stopNodes.push(c); }
  } else {
    // along each corridor, a station about every CORR_TARGET m: arterial crossings preferred, then any named cross street
    const picks = [];
    for (const [ki, K] of corridors.entries()) {
      const elig = [];
      K.nodes.forEach((id, i) => { const m = streetNames.get(id); if (!m) return;
        const cross = [...m.entries()].filter(([nm]) => corrKey(nm) !== K.key && core(nm) !== core(corrName.get(K.key))).sort((x, y) => y[1] - x[1])[0];
        if (cross) elig.push({ id, s: K.s[i], rank: cross[1], label: K.name + " & " + abbr(cross[0]), ki }); });
      elig.sort((x, y) => x.s - y.s); if (!elig.length) continue;
      let cur = elig.find(e => e.s <= 300) || elig[0]; picks.push(cur);
      for (;;) {
        const win = elig.filter(e => e.s >= cur.s + CORR_LO && e.s <= cur.s + CORR_HI);
        const next = win.length ? win.sort((x, y) => (y.rank * 400 - Math.abs(y.s - cur.s - CORR_TARGET)) - (x.rank * 400 - Math.abs(x.s - cur.s - CORR_TARGET)))[0]
          : elig.find(e => e.s > cur.s + CORR_LO);
        if (!next) break; picks.push(next); cur = next; }
    }
    // arterial-arterial crossings first, then the rest. A pick is dropped only if a kept station within MERGE_M sits on
    // the same corridor (so that corridor keeps a stop nearby), or if any kept station is within DUP_M.
    const onCorr = (pt, ki) => corridors[ki].nodes.some(id => hav(coord.get(id), pt) <= ON_M);
    const byId = new Map(); for (const p of picks) { const c = cands.find(x => x.id === p.id); const sc = c ? c.score : p.rank * 1000 + densityAt(coord.get(p.id));
      const prev = byId.get(p.id), kis = new Set(prev ? prev.kis : []); kis.add(p.ki);
      if (!prev || prev.score < sc) byId.set(p.id, { id: p.id, score: sc, label: c ? c.label : p.label, c: coord.get(p.id), kis }); else prev.kis = kis; }
    for (const c of [...byId.values()].sort((a, b) => b.score - a.score || a.id - b.id)) {
      if (stopNodes.some(s => hav(s.c, c.c) < DUP_M)) continue;
      if ([...c.kis].every(ki => stopNodes.some(s => hav(s.c, c.c) < MERGE_M && onCorr(s.c, ki)))) continue;
      stopNodes.push(c); }
  }
  const keep = new Set(stopNodes.map(s => s.id));

  // report: the largest gap between stations along each corridor (a station counts if within 150 m of the corridor)
  const corrReport = corridors.map(K => { const on = [];
    for (const s of stopNodes) { let bd = Infinity, bs = 0; K.nodes.forEach((id, i) => { const d = hav(coord.get(id), s.c); if (d < bd) { bd = d; bs = K.s[i]; } }); if (bd <= 150) on.push(bs); }
    on.sort((a, b) => a - b); let gap = on.length ? 0 : K.len; // gaps between stations; a corridor's ends past its last station don't count
    for (let i = 1; i < on.length; i++) gap = Math.max(gap, on[i] - on[i - 1]);
    return { name: K.name, km: +(K.len / 1000).toFixed(1), stations: on.length, maxGapKm: +(gap / 1000).toFixed(1) }; });
  const bad = corrReport.filter(r => r.maxGapKm > 2 || r.stations < 2);
  console.log("  " + C.id + (OLD ? " (old)" : "") + ": " + stopNodes.length + " stations, " + corridors.length + " corridors >= " + CORR_MIN_LEN / 1000 + " km, " + bad.length + " with a gap > 2 km or under 2 stations");
  bad.sort((a, b) => b.km - a.km).forEach(r => console.log("     ", r.name.padEnd(28), r.km + " km,", r.stations, "stations, max gap", r.maxGapKm + " km"));

  // contract degree-2 chains
  const deg = id => new Set(adj.get(id).map(e => e.to)).size, isJ = id => keep.has(id) || deg(id) !== 2;
  const edges = [], seen = new Set(), ek = (a, b) => a < b ? a + "_" + b : b + "_" + a;
  for (const u of adj.keys()) { if (!isJ(u)) continue;
    for (const first of adj.get(u)) { if (seen.has(ek(u, first.to))) continue;
      let prev = u, cur = first.to, len = first.len, kind = first.kind, drive = first.kind >= 1, pts = [coord.get(u), coord.get(cur)]; seen.add(ek(u, cur));
      while (!isJ(cur)) { const nx = adj.get(cur).find(e => e.to !== prev && !seen.has(ek(cur, e.to))); if (!nx) break;
        seen.add(ek(cur, nx.to)); len += nx.len; kind = Math.max(kind, nx.kind); drive = drive && nx.kind >= 1; prev = cur; cur = nx.to; pts.push(coord.get(cur)); }
      edges.push({ u, v: cur, len, kind, drive, pts }); } }
  const nodeIdx = new Map(); let ni = 0; const nodeCoord = [];
  for (const e of edges) for (const id of [e.u, e.v]) if (!nodeIdx.has(id)) { nodeIdx.set(id, ni++); nodeCoord.push(coord.get(id)); }
  const gadj = Array.from({ length: ni }, () => []);
  edges.forEach((e, k) => { const a = nodeIdx.get(e.u), b = nodeIdx.get(e.v); e.a = a; e.b = b; gadj[a].push([b, e.len, k]); gadj[b].push([a, e.len, k]); });

  const tractLen = new Array(tracts.length).fill(0);
  edges.forEach(e => { const m = e.pts[Math.floor(e.pts.length / 2)]; e.t = tracts.findIndex(t => pip(m, t.polys)); if (e.t >= 0 && e.kind > 0) tractLen[e.t] += e.len; });

  // service destinations, snapped to the nearest network node
  const dj = JSON.parse(fs.readFileSync(path.join(dir, "dests.json"), "utf8"));
  const destsRaw = [];
  for (const el of dj.elements) { const t = el.tags || {}, cat = destCategory(t); if (!cat) continue;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon, lat = el.lat != null ? el.lat : el.center && el.center.lat;
    if (lon == null || !inStudy(lon, lat)) continue;
    let bestN = -1, bd = Infinity; for (let i = 0; i < ni; i++) { const d = hav(nodeCoord[i], [lon, lat]); if (d < bd) { bd = d; bestN = i; } }
    if (bd > SNAP_MAX) continue;
    destsRaw.push({ cat, name: t.name || ({ food: "Food assistance", health: "Health clinic", civic: "Library or community center" })[cat], lon, lat, node: bestN, snap: bd }); }
  // drop duplicates (same name and category within 60 m)
  const dests = destsRaw.filter((d, i) => !destsRaw.slice(0, i).some(o => o.cat === d.cat && o.name === d.name && hav([o.lon, o.lat], [d.lon, d.lat]) < 60));

  // walk areas from each station
  function walk(src) { const dist = new Map([[src, 0]]), heap = [[0, src]];
    while (heap.length) { const [d, u] = heapPop(heap); if (d > dist.get(u)) continue;
      for (const [v, len] of gadj[u]) { const nd = d + len; if (nd <= WALK_M && nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); heapPush(heap, nd, v); } } }
    return dist; }
  const stopsOut = stopNodes.map(s => {
    const dist = walk(nodeIdx.get(s.id)), cover = [];
    edges.forEach((e, k) => { const da = dist.get(e.a), db = dist.get(e.b);
      let fa = da == null ? 0 : Math.min(e.len, WALK_M - da), fb = db == null ? 0 : Math.min(e.len, WALK_M - db);
      if (fa <= 0 && fb <= 0) return; if (fa + fb >= e.len) { fa = e.len; fb = 0; }
      cover.push([k, Math.round(Math.max(0, fa)), Math.round(Math.max(0, fb))]); });
    const reach = []; dests.forEach((d, di) => { const dd = dist.get(d.node); if (dd != null && dd + d.snap <= WALK_M) reach.push(di); });
    return { name: s.label, xy: proj(s.c[0], s.c[1]), cover, dests: reach };
  });

  // bus paths between nearby stations (streets only, arterials preferred)
  function busPath(src, dst) { const dist = new Map([[src, 0]]), prevE = new Map(), heap = [[0, src]];
    while (heap.length) { const [d, u] = heapPop(heap); if (d > dist.get(u)) continue; if (u === dst) break;
      for (const [v, len, k] of gadj[u]) { const e = edges[k]; if (!e.drive) continue; const nd = d + len * (e.kind === 2 ? 1 : LOCAL_PENALTY);
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prevE.set(v, [u, k]); heapPush(heap, nd, v); } } }
    if (!prevE.has(dst)) return null; const p = []; let n = dst, real = 0; while (n !== src) { const [pv, k] = prevE.get(n); p.push(k); real += edges[k].len; n = pv; }
    return { len: Math.round(real), edges: p.reverse() }; }
  const routes = [];
  for (let i = 0; i < stopNodes.length; i++) for (let j = i + 1; j < stopNodes.length; j++) {
    if (hav(stopNodes[i].c, stopNodes[j].c) > PAIR_MAX) continue;
    const p = busPath(nodeIdx.get(stopNodes[i].id), nodeIdx.get(stopNodes[j].id)); if (p) routes.push([i, j, p.len, p.edges]); }

  const [W, H] = proj(B.e, B.s);
  const data = {
    meta: { id: C.id, name: C.name, short: C.short, walkMeters: WALK_M, width: W, height: H, built: new Date().toISOString().slice(0, 10),
      labels: C.labels.map(l => [l[0]].concat(proj(l[1], l[2]))),
      sources: "Streets and service locations: OpenStreetMap contributors (ODbL). Population: City of Seattle Racial and Social Equity Composite Index, 2026 release (ACS 5-year estimates)." },
    tracts: tracts.map((t, i) => ({ geoid: t.geoid, name: t.name, pop: t.pop, poc: t.poc, low: t.low, povBase: t.povBase, streetLen: Math.round(tractLen[i]),
      rings: t.polys.map(poly => dpRing(poly[0].map(q => proj(q[0], q[1])), 6).flat()) })),
    edges: (() => { const o = { g: [], len: [], k: [], t: [] }; edges.forEach(e => { o.g.push(dp(e.pts.map(q => proj(q[0], q[1])), 2).flat()); o.len.push(Math.round(e.len)); o.k.push(e.kind); o.t.push(e.t); }); return o; })(),
    dests: dests.map(d => ({ cat: d.cat, name: d.name, xy: proj(d.lon, d.lat) })),
    stops: stopsOut, routes
  };
  const file = path.join(OUT, "data-" + C.id + ".js");
  fs.writeFileSync(file, "/* Generated by build-communities.js — draft data. */\nwindow.COMMUNITY_DATA = window.COMMUNITY_DATA || {};\nwindow.COMMUNITY_DATA[" + JSON.stringify(C.id) + "] = " + JSON.stringify(data) + ";\n");
  const pop = data.tracts.reduce((a, t) => a + t.pop, 0), dc = { food: 0, health: 0, civic: 0 }; data.dests.forEach(d => dc[d.cat]++);
  console.log(C.id.padEnd(13), "edges", edges.length, "| tracts", data.tracts.length, "| pop", pop, "| stops", stopsOut.length, "| paths", routes.length,
    "| dests", JSON.stringify(dc), "| map", W + "x" + H, "m | KB", Math.round(fs.statSync(file).size / 1024));
}
const only = process.argv[4];
for (const C of COMMUNITIES) { if (only && C.id !== only) continue; if (!fs.existsSync(path.join(RAW, C.id, "dests.json")) || !fs.existsSync(path.join(RAW, C.id, "osm.json"))) { console.log(C.id, "skipped: raw files missing"); continue; } build(C); }
