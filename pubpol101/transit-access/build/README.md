# Transit access simulator: data build (draft)

`build-seattle.js` turns two raw inputs into `../data.js`, which the page loads.

**Inputs** (not stored in this repo):
- `osm.json`: walkable ways and their nodes in the study area, from the OpenStreetMap Overpass API (© OpenStreetMap contributors, ODbL).
- `tracts.geojson`: census tracts with `POP_TOTAL_FOR_POC`, `POP_POC`, `POP_UNDER200PCT_POVERTY`, `POP_POV_STATUS_DETERMINED`, from the City of Seattle Racial and Social Equity Composite Index (ArcGIS FeatureServer).

**Run:** `node build-seattle.js <folder with osm.json and tracts.geojson> ../data.js`

**What it does**
1. Keeps streets north of the Ship Canal and the largest connected network.
2. Simplifies the network to intersections.
3. Finds each candidate stop's intersection by street names.
4. Precomputes the 800 m walking area for each stop (Dijkstra), including partly covered blocks.
5. Spreads each tract's residents evenly along its residential streets.

**Output format (`DATA` in data.js)**, the contract a replacement pipeline (for example, Python with block-level data) would produce:
- `meta`: `walkMeters`, `width`, `height` (map size in meters), `sources`.
- `edges`: parallel arrays.
  - `g`: flat `[x1,y1,x2,y2,...]` in meters from the map's top-left corner.
  - `len`: network length in meters.
  - `k`: kind (0 = path, 1 = local street, 2 = arterial).
  - `t`: tract index, or -1.
- `tracts`: one entry per tract.
  - `geoid`, `name`, `pop`, `poc`, `low`, `povBase`, `streetLen`.
  - `rings`: flat outlines in meters.
- `stops`: one entry per candidate stop.
  - `name`.
  - `xy`.
  - `cover`: list of `[edgeIndex, metersCoveredFromStart, metersCoveredFromEnd]`.

To move to block-level population, assign people to edges (or add a per-edge `pop` array) instead of the tract-based `perM` calculation in the page.
