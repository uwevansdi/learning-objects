# Public Service Delivery Exercise: data build (draft)

`build-communities.js` turns raw inputs for four Seattle communities into `../data-<id>.js`, one file per community. The page loads all four.

**Inputs per community folder** (not stored in this repo):
- `osm.json`: walkable ways and their nodes, from the OpenStreetMap Overpass API (© OpenStreetMap contributors, ODbL).
- `tracts.geojson`: census tracts with population, people of color, and people below 200% of poverty, from the City of Seattle Racial and Social Equity Composite Index (ArcGIS FeatureServer).
- `dests.json`: service locations from OpenStreetMap (`amenity` food_bank, social_facility, clinic, library, community_centre; `healthcare` clinic or centre). Shelters and other residential social facilities are excluded on purpose.

**Run:** `node build-communities.js <raw folder> .. [community id]`

**Per community, the build:**
1. Keeps the largest connected walkable network inside the study area. North of the Ship Canal also drops streets south of the canal.
2. Picks up to 28 candidate stations: arterial intersections ranked by street class, with ties broken by tract density, spaced at least 700 m apart.
3. Precomputes each station's 800 m walking area, the services inside it, and bus paths between station pairs within 3.2 km. Bus paths use streets only, with local streets weighted 1.6× so routes prefer arterials.
4. Spreads each tract's residents along its residential streets.

**Output format** is the same as the original transit draft (`../../transit-access/build/README.md`), plus:
- `dests` (category, name, position);
- each station's `dests` list;
- `meta.labels` for neighborhood names.

**Known gaps:**
- OpenStreetMap undercounts food banks and pantries; a local directory would be better.
- The highest-poverty tract used by the "community meeting" shock can be student-heavy near UW. Set `MANDATE_TRACT` in the page to choose it instead.
