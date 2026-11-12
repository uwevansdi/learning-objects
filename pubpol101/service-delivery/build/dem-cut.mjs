// Cuts a Seattle window out of the USGS 1-arc-second tile: <out>.bin (Int16, decimeters) + <out>.json (grid info).
import { fromFile } from "geotiff"; import fs from "fs";
const [src, out] = process.argv.slice(2), W = -122.45, E = -122.24, S = 47.48, N = 47.75;
const img = await (await fromFile(src)).getImage(), bb = img.getBoundingBox(), [rx, ry] = img.getResolution();
const x0 = Math.floor((W - bb[0]) / rx), x1 = Math.ceil((E - bb[0]) / rx), y0 = Math.floor((N - bb[3]) / ry), y1 = Math.ceil((S - bb[3]) / ry);
const r = (await img.readRasters({ window: [x0, y0, x1, y1] }))[0], w = x1 - x0, h = y1 - y0, a = new Int16Array(w * h);
for (let i = 0; i < a.length; i++) a[i] = Math.round((r[i] < -100 ? 0 : r[i]) * 10);
fs.writeFileSync(out + ".bin", Buffer.from(a.buffer));
fs.writeFileSync(out + ".json", JSON.stringify({ lon0: bb[0] + x0 * rx, lat0: bb[3] + y0 * ry, dlon: rx, dlat: ry, w, h, units: "decimeters", source: "USGS 3DEP 1 arc-second DEM, tile n48w123" }));
console.log("grid", w, "x", h);
