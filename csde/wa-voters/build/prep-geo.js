// Step 1: reproject and simplify the Secretary of State precinct shapefiles, one GeoJSON per source file.
// Usage: node prep-geo.js <raw folder> <out folder> <mapshaper binary>
// The raw folder holds p<year>/ (unzipped SOS downloads) and the Census cb_* folders.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [raw, out, ms] = process.argv.slice(2);

function run(args) { execFileSync(ms, args, { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" }); }
function shps(dir) {
  const found = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.shp$/i.test(f)) found.push(p); } })(dir);
  return found;
}
const q = s => '"' + s + '"';

// Precincts: keep every source field (the ID field differs by year), add area and an interior point.
for (const dir of fs.readdirSync(raw).filter(d => /^p\d{4}$/.test(d))) {
  const year = dir.slice(1), dest = path.join(out, year);
  fs.mkdirSync(dest, { recursive: true });
  for (const shp of shps(path.join(raw, dir))) {
    const name = path.basename(shp, path.extname(shp));
    const target = path.join(dest, name + ".geojson");
    if (fs.existsSync(target)) continue;
    run(["-i", q(shp), "snap", "-proj", "wgs84", "-clean", "allow-empty",
      "-each", q("_A=Math.round(this.area), _X=this.innerX, _Y=this.innerY"),
      "-simplify", "interval=10", "keep-shapes",
      "-o", q(target), "format=geojson", "precision=0.00001"]);
    console.log(year, name);
  }
}

// Legislative districts (three maps) and counties from Census cartographic boundary files.
for (const v of ["2018", "2022", "2024"]) {
  run(["-i", q(shps(path.join(raw, "cb_" + v + "_53_sldu_500k"))[0]), "-proj", "wgs84",
    "-each", q("id=+SLDUST"), "-filter-fields", "id", "-simplify", "interval=60", "keep-shapes",
    "-o", q(path.join(out, "ld-" + v + ".geojson")), "format=geojson", "precision=0.00001"]);
}
run(["-i", q(shps(path.join(raw, "cb_2024_us_county_500k"))[0]), "-filter", q("STATEFP=='53'"), "-proj", "wgs84",
  "-each", q("fips=STATEFP+COUNTYFP"), "-filter-fields", "fips,NAME", "-simplify", "interval=80", "keep-shapes",
  "-o", q(path.join(out, "counties.geojson")), "format=geojson", "precision=0.00001"]);
console.log("done");
