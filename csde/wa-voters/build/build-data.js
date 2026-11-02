// Step 2: join the CVAP tables to the prepared boundaries and write the page's data files.
// Usage: node build-data.js <geo-norm folder> <precinct csv> <LD csv> <out data folder> <topojson-server module path>
const fs = require("fs"), path = require("path");
const [norm, precCsv, ldCsv, out, topoPath] = process.argv.slice(2);
const { topology } = require(topoPath);

// ---------- CSV ----------
function csv(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const head = lines[0].split(",").map(s => s.replace(/"/g, ""));
  return lines.slice(1).map(l => {
    const cells = l.match(/("[^"]*"|[^,]*)(,|$)/g).map(s => s.replace(/,$/, "").replace(/^"|"$/g, ""));
    const o = {}; head.forEach((k, i) => o[k] = cells[i]); return o;
  });
}
// Value order used everywhere: total, Hispanic, then non-Hispanic White, Black, Asian, AIAN, NHPI, multiracial.
const MULTI = ["AIAN_White_CVAP", "Asian_White_CVAP", "Black_White_CVAP", "AIAN_Black_CVAP", "TwoOrMore_CVAP"];
function vals(r) {
  const g = k => +r[k] || 0;
  return [g("Total_CVAP"), g("Hispanic_CVAP"), g("WhiteAlone_CVAP"), g("BlackAlone_CVAP"), g("AsianAlone_CVAP"),
    g("AIANAlone_CVAP"), g("NHOPIAlone_CVAP"), MULTI.reduce((s, k) => s + g(k), 0)];
}
const add = (a, b) => a.map((x, i) => x + b[i]);
const rnd = v => v.map(x => Math.round(x));
const pad8 = s => String(s).replace(/\D/g, "").padStart(8, "0").slice(-8);

const P = csv(precCsv);
const COUNTY = {}, SOURCE = {};
const data = {}; // year -> id -> {cc, n, v}
for (const r of P) {
  COUNTY[r.CountyCode] = r.CountyName; SOURCE[r.Year] = r.Source;
  let id = /^[A-Z]{2}[0-9A-Z]{8}$/.test(r.St_Code) ? r.St_Code : r.CountyCode + pad8(r.St_Code.slice(2)); // normalizes malformed codes like "PI0002-101" (Pierce 2018)
  if (/0{8}$/.test(id) && /\d/.test(r.PrecName)) id = r.CountyCode + pad8(r.PrecName); // Spokane 2014 rows carry the code in the name
  const y = (data[r.Year] = data[r.Year] || {});
  const v = vals(r);
  if (!y[id]) y[id] = { cc: r.CountyCode, n: r.PrecName.replace(/ Voting District$/, ""), v };
  else { y[id].v = add(y[id].v, v); if (v[0] > 1 && /^\d/.test(y[id].n) === false && r.PrecName.length > y[id].n.length) y[id].n = r.PrecName; }
}
const YEARS = Object.keys(data).sort();
const LDR = csv(ldCsv), ldData = {}, LDSRC = {};
for (const r of LDR) { (ldData[r.Year] = ldData[r.Year] || {})[+r.District] = rnd(vals(r)); LDSRC[r.Year] = r.Source; }

// ---------- geometry helpers ----------
const readGeo = f => JSON.parse(fs.readFileSync(f, "utf8")).features.filter(f => f.geometry);
function polys(g) { return g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; }
function bbox(g) { let b = [180, 90, -180, -90]; for (const p of polys(g)) for (const [x, y] of p[0]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } return b; }
function inRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function inGeom(x, y, g) { for (const p of polys(g)) if (inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h))) return true; return false; }
function index(features) { return features.map(f => ({ f, b: bbox(f.geometry) })); }
function locate(idx, x, y) { for (const e of idx) if (x >= e.b[0] && x <= e.b[2] && y >= e.b[1] && y <= e.b[3] && inGeom(x, y, e.f.geometry)) return e.f; return null; }

// ---------- match precinct boundaries to CSV ids ----------
const CODES = Object.keys(COUNTY);
const byName = {}; for (const cc of CODES) byName[COUNTY[cc].toLowerCase()] = cc;
const FIPS = {}; // '53033' -> 'KI', learned from 2025, which has both
for (const f of readGeo(path.join(norm, "2025", "Statewide_Precincts_2025General.geojson"))) FIPS[f.properties.County] = f.properties.St_Code.slice(0, 2);
const normName = s => String(s || "").toLowerCase().replace(/ voting district$/, "").replace(/[^a-z0-9]/g, "");

function countyOf(p, file) {
  for (const k in p) { const v = String(p[k]).trim(); if (/county/i.test(k) && CODES.includes(v)) return v; }
  for (const k in p) { const v = String(p[k]).trim(); if (/^(county|countyfp10|fips)$/i.test(k)) { if (FIPS[v]) return FIPS[v]; if (FIPS["53" + v.padStart(3, "0")]) return FIPS["53" + v.padStart(3, "0")]; } }
  for (const k in p) { const v = String(p[k]).trim().toLowerCase(); if (/county/i.test(k) && byName[v]) return byName[v]; }
  const m = /^([A-Z]{2})_/.exec(path.basename(file)); return m ? m[1] : null;
}
// Every source field is tried two ways: as a precinct number and as a precinct name. The best-scoring field wins per county.
const SKIP = /^(county|fips|countyfp10|statefp10|cong|congdist|congress|leg|legis|legdist|legislativ|cla|ccdist|countyleg|commission|commdist|bocc_distr|court|id|objectid|sum_voters|aland10|awater10|area|perimeter|population|pop2000|pop2010|2010_pop|gisacres|sum_acreag|shape_.*|elevation|thickness|color|.*color|ext[xyz]|ltscale|lineWt|.*linewt|lyr.*)$/i;
function candidates(p, cc, names) {
  const c = {};
  for (const k in p) {
    if (k[0] === "_" || SKIP.test(k) || /county/i.test(k)) continue;
    const v = String(p[k] === null ? "" : p[k]).trim(); if (!v) continue;
    const digits = v.replace(/\D/g, "");
    if (/^[A-Z]{2}[0-9A-Z]{8}$/.test(v)) c[k + "#id"] = v;
    else if (/^[A-Z]{2}\d+$/.test(v)) c[k + "#id"] = v.slice(0, 2) + pad8(v.slice(2));
    else if (digits && digits.length <= 8 && /^[A-Za-z]{0,5}[\d\s-]+$/.test(v)) c[k + "#id"] = cc + pad8(digits);
    if (/^\d{10}$/.test(v) && /geoid/i.test(k)) c[k + "#vtd"] = cc + pad8(v.slice(5));
    for (const n of [normName(v), normName(v.replace(/^\d+\s+/, "")), normName(v.replace(/\s+\d+$/, ""))])
      if (names[n]) { c[k + "#name"] = names[n]; break; }
  }
  return c;
}

const geomYear = y => (y === "2011" ? "2012" : y); // no 2011 boundaries are published; 2011 precinct counts match 2012
const report = [], built = {}; // year -> features with clean props
for (const y of YEARS) {
  const dir = path.join(norm, geomYear(y));
  const feats = [];
  for (const f of fs.readdirSync(dir)) for (const g of readGeo(path.join(dir, f))) { const cc = countyOf(g.properties, f); if (cc) feats.push({ g, cc, file: f }); }
  const want = data[y];
  const groups = {}; feats.forEach(x => (groups[x.cc] = groups[x.cc] || []).push(x));
  const merged = {};
  let matchedPop = 0, totalPop = 0, unmatchedGeo = 0;
  for (const cc in groups) {
    // pick, for this county, the field whose values match the most CSV ids
    const names = {}; for (const id in want) if (want[id].cc === cc) { const n = normName(want[id].n); if (n) names[n] = names[n] === undefined ? id : null; }
    const score = {};
    for (const x of groups[cc]) { x.cand = candidates(x.g.properties, cc, names); for (const k in x.cand) if (want[x.cand[k]]) (score[k] = score[k] || new Set()).add(x.cand[k]); }
    const ranked = Object.keys(score).sort((a, b) => score[b].size - score[a].size); // distinct precincts matched, so one repeated name cannot win
    for (const x of groups[cc]) {
      const k = ranked.find(k => x.cand[k] && want[x.cand[k]]);
      const id = k && x.cand[k];
      if (!id) { unmatchedGeo++; continue; }
      const p = x.g.properties, m = merged[id];
      if (!m) merged[id] = { id, cc, geometry: x.g.geometry, A: p._A, X: p._X, Y: p._Y, big: p._A };
      else {
        m.geometry = { type: "MultiPolygon", coordinates: polys(m.geometry).concat(polys(x.g.geometry)) };
        m.A += p._A; if (p._A > m.big) { m.big = p._A; m.X = p._X; m.Y = p._Y; }
      }
    }
  }
  for (const id in want) { totalPop += want[id].v[0]; if (merged[id]) matchedPop += want[id].v[0]; }
  built[y] = merged;
  report.push({ year: y, boundaries: geomYear(y), csvPrecincts: Object.keys(want).length, mapped: Object.keys(merged).length, unmatchedShapes: unmatchedGeo, popMatched: (100 * matchedPop / totalPop).toFixed(2) + "%" });
}
// Where a year's file lacks a precinct, borrow that precinct's boundary from the nearest year that has it (flagged with `b`).
for (const r of report) {
  const y = r.year, have = built[y]; let borrowed = 0, pop = 0, tot = 0;
  for (const id in data[y]) {
    tot += data[y][id].v[0];
    if (!have[id]) for (const d of [1, -1, 2, -2, 3, -3]) { const src = built[String(+y + d)]; if (src && src[id] && !src[id].b) { have[id] = { ...src[id], b: String(+y + d) }; borrowed++; break; } }
    if (have[id]) pop += data[y][id].v[0];
  }
  r.borrowed = borrowed; r.popMapped = (100 * pop / tot).toFixed(2) + "%";
}
for (const y in built) built[y] = Object.values(built[y]);
console.table(report);

// ---------- which district map does each LD year use? ----------
const LDMAPS = { "2012": readGeo(path.join(norm, "ld-2018.geojson")), "2022": readGeo(path.join(norm, "ld-2022.geojson")), "2024": readGeo(path.join(norm, "ld-2024.geojson")) };
const LDIDX = {}; for (const m in LDMAPS) LDIDX[m] = index(LDMAPS[m]);
function aggregate(y, map) {
  const sums = {};
  for (const f of built[y]) { const d = locate(LDIDX[map], f.X, f.Y); if (d) { const k = d.properties.id; sums[k] = sums[k] ? add(sums[k], data[y][f.id].v) : data[y][f.id].v.slice(); } }
  return sums;
}
const ERA = {}, eraRows = [];
for (const y of Object.keys(ldData).sort()) {
  const fit = {};
  for (const m in LDMAPS) {
    const s = aggregate(y, m); let err = 0, n = 0;
    for (const d in ldData[y]) if (s[d]) { err += Math.abs(s[d][1] / s[d][0] - ldData[y][d][1] / ldData[y][d][0]) + Math.abs(s[d][0] - ldData[y][d][0]) / ldData[y][d][0]; n++; }
    fit[m] = err / n;
  }
  ERA[y] = Object.keys(fit).sort((a, b) => fit[a] - fit[b])[0];
  eraRows.push({ year: y, ...Object.fromEntries(Object.entries(fit).map(([k, v]) => ["map " + k, v.toFixed(4)])), chosen: ERA[y] });
}
console.table(eraRows);
const eraOf = y => ERA[y] || (+y < 2022 ? "2012" : "2024"); // precinct-only years before 2016 use the 2012 map

// ---------- write files ----------
const mkdir = d => fs.mkdirSync(d, { recursive: true });
const writeJSON = (f, o) => { mkdir(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o)); };
const topo = (fc, name) => topology({ [name]: fc }, 1e5);
const r5 = x => Math.round(x * 1e5) / 1e5;

// precincts: one TopoJSON per year per county; props: id, n (name), v (values), a (km2), p (interior point), d (district)
const COUNTY_LDS = {}; // era -> cc -> Set(ld)
const sizes = [];
// A precinct's district is the one in effect for that election year (the LD table above is labeled differently).
const electionMap = y => (+y >= 2024 ? "2024" : +y >= 2022 ? "2022" : +y >= 2012 ? "2012" : null);
for (const y of YEARS) {
  const era = electionMap(y), byCC = {};
  for (const f of built[y]) {
    const d = era && locate(LDIDX[era], f.X, f.Y);
    const ld = d ? d.properties.id : null;
    if (ld) (((COUNTY_LDS[era] = COUNTY_LDS[era] || {})[f.cc] = COUNTY_LDS[era][f.cc] || new Set())).add(ld);
    f.ld = ld;
    (byCC[f.cc] = byCC[f.cc] || []).push({ type: "Feature", geometry: f.geometry,
      properties: { id: f.id, n: data[y][f.id].n, v: rnd(data[y][f.id].v), a: Math.round(f.A / 1e4) / 100, p: [r5(f.X), r5(f.Y)], d: ld, ...(f.b ? { b: f.b } : {}) } });
  }
  for (const cc in byCC) {
    const file = path.join(out, "p", y, cc + ".json");
    writeJSON(file, topo({ type: "FeatureCollection", features: byCC[cc] }, "p"));
    sizes.push(fs.statSync(file).size);
  }
  // statewide value table for "precincts like this one"
  writeJSON(path.join(out, "s", y + ".json"), built[y].map(f => [f.id, data[y][f.id].n, rnd(data[y][f.id].v), [r5(f.X), r5(f.Y)]]));
}
console.log("precinct files", sizes.length, "total MB", (sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1), "largest KB", Math.round(Math.max(...sizes) / 1e3));

// history: for each latest-year precinct, the precinct that held its interior point in every other year
const LAST = YEARS[YEARS.length - 1];
const yearIdx = {}; for (const y of YEARS) { yearIdx[y] = {}; for (const f of built[y]) (yearIdx[y][f.cc] = yearIdx[y][f.cc] || []).push({ f: { geometry: f.geometry, id: f.id, A: f.A }, b: bbox(f.geometry) }); }
const hist = {};
for (const f of built[LAST]) {
  const row = {};
  for (const y of YEARS) {
    const e = (yearIdx[y][f.cc] || []).find(e => f.X >= e.b[0] && f.X <= e.b[2] && f.Y >= e.b[1] && f.Y <= e.b[3] && inGeom(f.X, f.Y, e.f.geometry));
    if (!e) continue;
    const same = e.f.id === f.id && Math.abs(e.f.A - f.A) / f.A < 0.03 ? 1 : 0; // 1 = same code and about the same area as today
    row[y] = [rnd(data[y][e.f.id].v), data[y][e.f.id].n, same];
  }
  (hist[f.cc] = hist[f.cc] || {})[f.id] = row;
}
for (const cc in hist) writeJSON(path.join(out, "h", cc + ".json"), hist[cc]);

// who moved: today's residents (latest estimates) by current district and by the district they were in under the previous map
const moves = {};
for (const [now, prev] of [["2024", "2022"], ["2022", "2012"]]) {
  moves[now] = {};
  for (const f of built[LAST]) {
    const a = locate(LDIDX[now], f.X, f.Y), b = locate(LDIDX[prev], f.X, f.Y);
    if (!a || !b) continue;
    const m = (moves[now][a.properties.id] = moves[now][a.properties.id] || {});
    m[b.properties.id] = (m[b.properties.id] || 0) + Math.round(data[LAST][f.id].v[0]);
  }
}

// counties: geometry plus per-year totals (county lines are fixed, so these trends are like-for-like)
const counties = readGeo(path.join(norm, "counties.geojson")).map(f => ({ type: "Feature", geometry: f.geometry, properties: { cc: FIPS[f.properties.fips], n: f.properties.NAME } }));
writeJSON(path.join(out, "counties.json"), topo({ type: "FeatureCollection", features: counties }, "c"));
for (const m in LDMAPS) writeJSON(path.join(out, "ld-" + m + ".json"), topo({ type: "FeatureCollection", features: LDMAPS[m].map(f => ({ type: "Feature", geometry: f.geometry, properties: { id: f.properties.id } })) }, "d"));

const cv = {}, st = {};
for (const y of YEARS) { for (const id in data[y]) { const r = data[y][id]; cv[r.cc] = cv[r.cc] || {}; cv[r.cc][y] = cv[r.cc][y] ? add(cv[r.cc][y], r.v) : r.v.slice(); st[y] = st[y] ? add(st[y], r.v) : r.v.slice(); } }
for (const cc in cv) for (const y in cv[cc]) cv[cc][y] = rnd(cv[cc][y]);
for (const y in st) st[y] = rnd(st[y]);
// today's district lines, rebuilt from each year's precincts, for like-for-like district trends
const ldNow = {}; for (const y of YEARS) { const s = aggregate(y, "2024"); ldNow[y] = {}; for (const d in s) ldNow[y][d] = rnd(s[d]); }
const cl = {}; for (const e in COUNTY_LDS) { cl[e] = {}; for (const cc in COUNTY_LDS[e]) cl[e][cc] = [...COUNTY_LDS[e][cc]].sort((a, b) => a - b); }
writeJSON(path.join(out, "summary.json"), {
  built: new Date().toISOString().slice(0, 10), years: YEARS, source: SOURCE, ldYears: Object.keys(ldData).sort(), ldSource: LDSRC,
  counties: COUNTY, county: cv, state: st, ld: ldData, ldEra: ERA, eraOfYear: Object.fromEntries(YEARS.map(y => [y, eraOf(y)])),
  countyLds: cl, moves, ldNow, match: report
});
console.log("done");
