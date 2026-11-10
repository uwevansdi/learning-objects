# Public Service Delivery Exercise: data build (draft)

`build-communities.js` turns raw inputs for four Seattle communities into `../data-<id>.js`, one file per community. The page loads all four.

**Inputs per community folder** (not stored in this repo):
- `osm.json`: walkable ways and their nodes, from the OpenStreetMap Overpass API (© OpenStreetMap contributors, ODbL).
- `tracts.geojson`: census tracts with population, people of color, and people below 200% of poverty, from the City of Seattle Racial and Social Equity Composite Index (ArcGIS FeatureServer).
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

**Output format** is the same as the original transit draft (`../../transit-access/build/README.md`), plus:
- `dests` (category, name, position);
- each station's `dests` list;
- `meta.labels` for neighborhood names.

**Known gaps:**
- OpenStreetMap undercounts food banks and pantries; a local directory would be better.
- The highest-poverty tract used by the "community meeting" shock can be student-heavy near UW. Set `MANDATE_TRACT` in the page to choose it instead.
