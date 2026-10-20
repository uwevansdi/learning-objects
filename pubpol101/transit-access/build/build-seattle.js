// Build data for the Seattle transit access simulator (draft).
// Usage: node build-seattle.js <raw dir> <out data.js>
// Inputs: osm.json (Overpass: walkable ways + nodes), tracts.geojson (City of Seattle RSE index tracts)
const fs = require("fs"), path = require("path");
const RAW = process.argv[2], OUT = process.argv[3];
const WALK_M = 800;               // ~10 minutes at 4.8 km/h
const BBOX = { w: -122.410, e: -122.285, s: 47.645, n: 47.693 };
const LAT0 = 47.668, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111320;
const proj = (lon, lat) => [Math.round((lon - BBOX.w) * KX), Math.round((BBOX.n - lat) * KY)];

// Approximate Ship Canal / Lake Union / Portage Bay / Montlake Cut line (lon, lat), west to east.
const CANAL = [[-122.420, 47.6660], [-122.3975, 47.6653], [-122.385, 47.6612], [-122.376, 47.6592], [-122.365, 47.6560],
  [-122.3505, 47.6492], [-122.3405, 47.6466], [-122.335, 47.6457], [-122.3255, 47.6478], [-122.3205, 47.6527],
  [-122.310, 47.6507], [-122.304, 47.6478], [-122.280, 47.6480]];
function canalLat(lon) {
  for (let i = 1; i < CANAL.length; i++) if (lon <= CANAL[i][0]) {
    const [x0, y0] = CANAL[i - 1], [x1, y1] = CANAL[i]; return y0 + (y1 - y0) * (lon - x0) / (x1 - x0);
  }
  return CANAL[CANAL.length - 1][1];
}
const inStudy = (lon, lat) => lon >= BBOX.w && lon <= BBOX.e && lat <= BBOX.n && lat > canalLat(lon) + 0.0002;

// ---- Candidate stops: intersections of named streets ----------------------------------
const STOPS = [
  ["NW Market St & 24th Ave NW", "Northwest Market Street", "24th Avenue Northwest"],
  ["NW Market St & 15th Ave NW", "Northwest Market Street", "15th Avenue Northwest"],
  ["NW Market St & 8th Ave NW", "Northwest Market Street", "8th Avenue Northwest"],
  ["Leary Way NW & 15th Ave NW", "Leary Way Northwest", "15th Avenue Northwest"],
  ["NW 65th St & 24th Ave NW", "Northwest 65th Street", "24th Avenue Northwest"],
  ["NW 65th St & 15th Ave NW", "Northwest 65th Street", "15th Avenue Northwest"],
  ["NW 65th St & 8th Ave NW", "Northwest 65th Street", "8th Avenue Northwest"],
  ["NW 85th St & 24th Ave NW", "Northwest 85th Street", "24th Avenue Northwest"],
  ["NW 85th St & 15th Ave NW", "Northwest 85th Street", "15th Avenue Northwest"],
  ["N 85th St & Greenwood Ave N", "North 85th Street", "Greenwood Avenue North"],
  ["N 85th St & Aurora Ave N", "North 85th Street", "Aurora Avenue North"],
  ["Greenwood Ave N & N 65th St", "Greenwood Avenue North", "North 65th Street"],
  ["Phinney Ave N & N 50th St", "Phinney Avenue North", "North 50th Street"],
  ["Fremont Ave N & N 34th St", "Fremont Avenue North", "North 34th Street"],
  ["Fremont Ave N & N 46th St", "Fremont Avenue North", "North 46th Street"],
  ["Stone Way N & N 34th St", "Stone Way North", "North 34th Street"],
  ["Stone Way N & N 45th St", "Stone Way North", "North 45th Street"],
  ["Aurora Ave N & N 46th St", "Aurora Avenue North", "North 46th Street"],
  ["Aurora Ave N & N 65th St", "Aurora Avenue North", "North 65th Street"],
  ["Green Lake Way N & N 50th St", "Green Lake Way North", "North 50th Street"],
  ["N 45th St & Wallingford Ave N", "North 45th Street", "Wallingford Avenue North"],
  ["NE 45th St & Roosevelt Way NE", "Northeast 45th Street", "Roosevelt Way Northeast"],
  ["NE 45th St & University Way NE", "Northeast 45th Street", "University Way Northeast"],
  ["NE 45th St & 15th Ave NE", "Northeast 45th Street", "15th Avenue Northeast"],
  ["NE 45th St & 25th Ave NE", "Northeast 45th Street", "25th Avenue Northeast"],
  ["NE 50th St & Roosevelt Way NE", "Northeast 50th Street", "Roosevelt Way Northeast"],
  ["NE 65th St & Roosevelt Way NE", "Northeast 65th Street", "Roosevelt Way Northeast"],
  ["NE 65th St & 15th Ave NE", "Northeast 65th Street", "15th Avenue Northeast"],
  ["NE 65th St & 25th Ave NE", "Northeast 65th Street", "25th Avenue Northeast"],
  ["NE 75th St & Roosevelt Way NE", "Northeast 75th Street", "Roosevelt Way Northeast"],
  ["NE 75th St & 15th Ave NE", "Northeast 75th Street", "15th Avenue Northeast"],
  ["NE Pacific St & 15th Ave NE", "Northeast Pacific Street", "15th Avenue Northeast"]
];

// ---- Load OSM ------------------------------------------------------------------------------
const osm = JSON.parse(fs.readFileSync(path.join(RAW, "osm.json"), "utf8"));
const coord = new Map();
for (const e of osm.elements) if (e.type === "node") coord.set(e.id, [e.lon, e.lat]);
const ways = osm.elements.filter(e => e.type === "way");
const KIND = h => /^(primary|secondary|trunk)(_link)?$/.test(h) ? 2 : /^(tertiary|tertiary_link|residential|unclassified|living_street)$/.test(h) ? 1 : 0;
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

// raw adjacency: node -> [{to, len, kind}]
const adj = new Map(), namesAt = new Map();
function addEdge(a, b, len, kind) {
  if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push({ to: b, len, kind }); adj.get(b).push({ to: a, len, kind });
}
for (const w of ways) {
  const kind = KIND(w.tags.highway);
  for (let i = 0; i < w.nodes.length; i++) {
    const id = w.nodes[i], c = coord.get(id); if (!c || !inStudy(c[0], c[1])) continue;
    if (w.tags.name) { if (!namesAt.has(id)) namesAt.set(id, new Set()); namesAt.get(id).add(w.tags.name); }
    if (i === 0) continue;
    const pid = w.nodes[i - 1], pc = coord.get(pid); if (!pc || !inStudy(pc[0], pc[1])) continue;
    if (pid !== id) addEdge(pid, id, hav(pc, c), kind);
  }
}
// largest connected component
const comp = new Map(); let best = null, bestSize = 0;
for (const start of adj.keys()) {
  if (comp.has(start)) continue; const stack = [start], members = []; comp.set(start, start);
  while (stack.length) { const u = stack.pop(); members.push(u); for (const e of adj.get(u)) if (!comp.has(e.to)) { comp.set(e.to, start); stack.push(e.to); } }
  if (members.length > bestSize) { bestSize = members.length; best = start; }
}
for (const id of [...adj.keys()]) if (comp.get(id) !== best) adj.delete(id);
for (const [id, list] of adj) adj.set(id, list.filter(e => adj.has(e.to)));

// stop nodes
const stopNodes = [];
for (const [label, a, b] of STOPS) {
  let found = null;
  for (const [id, set] of namesAt) if (adj.has(id) && set.has(a) && set.has(b)) { found = id; break; }
  if (!found) { console.warn("NOT FOUND:", label); continue; }
  stopNodes.push({ label, node: found });
}
const keep = new Set(stopNodes.map(s => s.node));

// ---- Contract degree-2 chains into polyline edges ---------------------------------------------
const deg = id => new Set(adj.get(id).map(e => e.to)).size;
const isJunction = id => keep.has(id) || deg(id) !== 2;
const edges = [], seen = new Set(); // edge: {u, v, len, kind, pts:[[lon,lat],...]}
const ekey = (a, b) => a < b ? a + "_" + b : b + "_" + a;
for (const u of adj.keys()) {
  if (!isJunction(u)) continue;
  for (const first of adj.get(u)) {
    if (seen.has(ekey(u, first.to))) continue;
    let prev = u, cur = first.to, len = first.len, kind = first.kind, drive = first.kind >= 1, pts = [coord.get(u), coord.get(cur)];
    seen.add(ekey(u, cur));
    while (!isJunction(cur)) {
      const nxt = adj.get(cur).find(e => e.to !== prev && !seen.has(ekey(cur, e.to)));
      if (!nxt) break;
      seen.add(ekey(cur, nxt.to)); len += nxt.len; kind = Math.max(kind, nxt.kind); drive = drive && nxt.kind >= 1;
      prev = cur; cur = nxt.to; pts.push(coord.get(cur));
    }
    edges.push({ u, v: cur, len, kind, drive, pts });
  }
}
// pure cycles with no junction are ignored (rare: isolated loops)
const nodeIdx = new Map(); let ni = 0;
for (const e of edges) for (const id of [e.u, e.v]) if (!nodeIdx.has(id)) nodeIdx.set(id, ni++);
const gadj = Array.from({ length: ni }, () => []);
edges.forEach((e, k) => { const a = nodeIdx.get(e.u), b = nodeIdx.get(e.v); e.a = a; e.b = b; gadj[a].push([b, e.len, k]); gadj[b].push([a, e.len, k]); });

// ---- Tracts ----------------------------------------------------------------------------------------
const tj = JSON.parse(fs.readFileSync(path.join(RAW, "tracts.geojson"), "utf8"));
function rings(g) { return g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; }
function pip(pt, polys) {
  let inside = false;
  for (const poly of polys) { let inPoly = false;
    for (let r = 0; r < poly.length; r++) { const ring = poly[r]; let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
      }
      if (r === 0) inPoly = c; else if (c) inPoly = false;
    }
    if (inPoly) inside = true; }
  return inside;
}
function centroid(polys) { let sx = 0, sy = 0, n = 0; for (const p of polys) for (const [x, y] of p[0]) { sx += x; sy += y; n++; } return [sx / n, sy / n]; }
const tracts = tj.features.map(f => ({ geoid: f.properties.GEOID, name: f.properties.NAME, pop: f.properties.POP_TOTAL_FOR_POC || 0,
  poc: f.properties.POP_POC || 0, low: f.properties.POP_UNDER200PCT_POVERTY || 0, povBase: f.properties.POP_POV_STATUS_DETERMINED || 0,
  polys: rings(f.geometry) })).filter(t => { const c = centroid(t.polys); return inStudy(c[0], c[1]); });

// assign each edge to a tract by its midpoint; residential weight only on streets (kind 1–2)
const tractLen = new Array(tracts.length).fill(0);
edges.forEach(e => {
  const m = e.pts[Math.floor(e.pts.length / 2)];
  e.t = tracts.findIndex(t => pip(m, t.polys));
  if (e.t >= 0 && e.kind > 0) tractLen[e.t] += e.len;
});

// ---- Walksheds (Dijkstra with cutoff) --------------------------------------------------------------
function dijkstra(src) {
  const dist = new Map([[src, 0]]), heap = [[0, src]];
  const push = (d, n) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) { const [d, u] = pop(); if (d > dist.get(u)) continue;
    for (const [v, len] of gadj[u]) { const nd = d + len; if (nd <= WALK_M && nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); push(nd, v); } } }
  return dist;
}
const stopsOut = stopNodes.map(s => {
  const src = nodeIdx.get(s.node), dist = dijkstra(src), cover = [];
  edges.forEach((e, k) => {
    const da = dist.get(e.a), db = dist.get(e.b);
    let fa = da == null ? 0 : Math.min(e.len, WALK_M - da), fb = db == null ? 0 : Math.min(e.len, WALK_M - db);
    if (fa <= 0 && fb <= 0) return;
    if (fa + fb >= e.len) { fa = e.len; fb = 0; }
    cover.push([k, Math.round(Math.max(0, fa)), Math.round(Math.max(0, fb))]);
  });
  const c = coord.get(s.node);
  return { name: s.label, xy: proj(c[0], c[1]), cover };
});

// ---- Bus paths between candidate stations ----------------------------------------------------
// Shortest drivable path, preferring arterials (local streets cost 1.6x), for station pairs within 3.2 km straight-line.
const PAIR_MAX = 3200, LOCAL_PENALTY = 1.6;
function busPath(src, dst) {
  const dist = new Map([[src, 0]]), prevE = new Map(), heap = [[0, src]];
  const push = (d, n) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) { const [d, u] = pop(); if (d > dist.get(u)) continue; if (u === dst) break;
    for (const [v, len, k] of gadj[u]) { const e = edges[k]; if (!e.drive) continue;
      const nd = d + len * (e.kind === 2 ? 1 : LOCAL_PENALTY);
      if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prevE.set(v, [u, k]); push(nd, v); } } }
  if (!prevE.has(dst)) return null;
  const path = []; let n = dst, real = 0; while (n !== src) { const [p, k] = prevE.get(n); path.push(k); real += edges[k].len; n = p; }
  return { len: Math.round(real), edges: path.reverse() };
}
const routes = [];
for (let i = 0; i < stopNodes.length; i++) for (let j = i + 1; j < stopNodes.length; j++) {
  const ci = coord.get(stopNodes[i].node), cj = coord.get(stopNodes[j].node);
  if (hav(ci, cj) > PAIR_MAX) continue;
  const p = busPath(nodeIdx.get(stopNodes[i].node), nodeIdx.get(stopNodes[j].node));
  if (p) routes.push([i, j, p.len, p.edges]);
}

// ---- Simplify + project geometry ------------------------------------------------------------------
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return dp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(dp(pts.slice(idx), tol));
}
// Closed rings: split at the point farthest from the start so Douglas-Peucker has a real baseline.
function dpRing(pts, tol) {
  if (pts.length < 5) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
  return dp(pts.slice(0, far + 1), tol).slice(0, -1).concat(dp(pts.slice(far), tol));
}
const edgesOut = edges.map(e => {
  const p = dp(e.pts.map(q => proj(q[0], q[1])), 2);
  return { g: p.flat(), len: Math.round(e.len), k: e.kind, t: e.t };
});
const tractsOut = tracts.map((t, i) => ({
  geoid: t.geoid, name: t.name, pop: t.pop, poc: t.poc, low: t.low, povBase: t.povBase,
  streetLen: Math.round(tractLen[i]),
  rings: t.polys.map(poly => dpRing(poly[0].map(q => proj(q[0], q[1])), 6).flat())
}));
const [W, H] = proj(BBOX.e, BBOX.s);
const data = {
  meta: { walkMeters: WALK_M, width: W, height: H, built: new Date().toISOString().slice(0, 10),
    sources: "Streets: OpenStreetMap contributors (ODbL). Population: City of Seattle Racial and Social Equity Composite Index, 2026 release (ACS 5-year estimates)." },
  tracts: tractsOut,
  edges: { g: edgesOut.map(e => e.g), len: edgesOut.map(e => e.len), k: edgesOut.map(e => e.k), t: edgesOut.map(e => e.t) },
  stops: stopsOut,
  routes: routes   // [stationA, stationB, meters, [edge indices in order from A to B]]
};
fs.writeFileSync(OUT, "/* Generated by build-seattle.js — draft data. */\nvar DATA = " + JSON.stringify(data) + ";\n");
const studyPop = tractsOut.reduce((a, t) => a + t.pop, 0);
console.log("edges", edgesOut.length, "| nodes", ni, "| tracts", tractsOut.length, "| study pop", studyPop, "| stops", stopsOut.length, "| size KB", Math.round(fs.statSync(OUT).size / 1024), "| map m", W, "x", H);
console.log("bus paths between station pairs:", routes.length);
console.log("avg covered edges per stop", Math.round(stopsOut.reduce((a, s) => a + s.cover.length, 0) / stopsOut.length));
