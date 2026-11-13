# Public Service Delivery Exercise: data build (draft)

`build-communities.js` turns raw inputs for four Seattle communities into `../data-<id>.js`, one file per community. The page loads all four.

**Inputs per community folder** (not stored in this repo):
- `osm.json`: walkable ways and their nodes, from the OpenStreetMap Overpass API (© OpenStreetMap contributors, ODbL).
- `blockgroups.geojson` (one file for all communities, in the raw folder itself; v3, 12 Nov 2026): Prof. Zhao's Seattle block groups (`pubpol101_seattle_bg_2024.geojson`).
  - ACS 2020–2024 population, people of color, poverty universe and people below 200% of poverty.
  - EPA Smart Location Database walkability index and intersection density, joined from 2010 to 2020 block groups.
  - Checked against the City of Seattle RSE tract data used before: rolled up to tracts, all four counts match exactly for all 130 tracts in the study areas.
  - Block groups where poverty is measured for under 80% of residents (mostly UW dorms) get no poverty rate in the page. Their low-income counts still use the people Census counted.
  - The "community meeting" target for North of the Ship Canal is fixed on central Ballard (530330047023, 27% below 200%) in the page's `MANDATE_AREA`, because its highest-poverty block groups are student housing.
- `dests.json`: service locations from OpenStreetMap (`amenity` food_bank, social_facility, clinic, library, community_centre; `healthcare` clinic or centre). Shelters and other residential social facilities are excluded on purpose.

**Run:** `node build-communities.js <raw folder> .. [community id]`

**Per community, the build:**
1. Keeps the largest connected walkable network inside the study area. North of the Ship Canal also drops streets south of the canal.
2. Places candidate stations along corridors (v2, 10 Nov 2026).
   - Every named arterial at least 1.2 km long is a corridor, so 15th Ave NW and 15th Ave NE stay separate.
   - Along each corridor, a candidate goes about every 1 km (650–1,300 m), preferring arterial crossings and otherwise a named cross street.
   - A candidate is dropped only when another one within 450 m already sits on the same corridor, or one is within 150 m.
   - Result: every corridor can meet the 400 m–2 km spacing rule. The exceptions are stretches with no cross streets at all: Seaview Ave NW, Airport Way S by Boeing Field, and short industrial stretches of MLK and E Marginal Way.
   - `OLD=1` reproduces the v1 method (top 28 arterial crossings, 700 m apart). It failed on Delridge, 15th Ave W/NW, NW 80th St and many others.
   - The build prints a per-corridor gap report.
3. Precomputes each station's 800 m walking area, the services inside it, and bus paths between station pairs within 2.6 km. Pairs farther apart can't be consecutive stops under the 2 km rule. Bus paths use streets only, with local streets weighted 1.6× so routes prefer arterials.
4. Spreads each tract's residents along its residential streets.

**Output format** is the same as the original transit draft (`../../pubpol101/transit-access/build/README.md`), plus:
- `dests` (category, name, position);
- each station's `dests` list;
- `meta.labels` for neighborhood names.

**Known gaps:**
- OpenStreetMap undercounts food banks and pantries; a local directory would be better.
- The highest-poverty area can be student housing near UW, so North of the Ship Canal's "community meeting" target is fixed on central Ballard in the page's `MANDATE_AREA`. Other communities can be set there too.

## Hills (v4, 12 Nov 2026)

- **Input:** `elev.bin` and `elev.json` in the raw folder. To make them:
  1. Download the USGS 3DEP 1-arc-second tile `USGS_1_n48w123.tif` from the USGS National Map.
  2. Run `node dem-cut.mjs <tile> <raw dir>/elev`. It needs `npm install geotiff@2.1.3` and writes elevation in decimeters.
- **Method:** walking cost on each street segment = length × (flat speed ÷ slope speed), from Tobler's hiking function, averaged over the uphill and downhill directions.
  - Slopes are capped at ±40%.
  - Bridges, tunnels and raised layers count as level, so a deck over low ground doesn't read as a cliff.
  - A 10-minute walk is still 800 m on flat ground.
- **Effect:** with hills, an average walk area keeps 92% of its residents in West Seattle and 95% in both north communities. The steepest stations lose 20–30% (Admiral Way, Beacon Hill). Southeast's community average isn't computed because one station has no residents on flat ground.
- **Comparison:** `FLAT=1` turns hills off.
- **Walkability index dropped:** the EPA National Walkability Index is no longer shown. It weights distance to existing transit and job mix, ignores hills and residential density, and ranked a sparse, steep, partly industrial block group (99-4, with Harbor Island) at the Seattle median. Intersection density remains as "Street connectivity".
