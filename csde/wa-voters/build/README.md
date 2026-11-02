# Who Can Vote in Washington: data build (draft)

Two node scripts turn the CSDE citizen voting-age population (CVAP) tables and public boundary files into the page's `../data/` folder.

## Inputs (not stored in this repo)

- **CVAP tables** from the Washington elections data project (UW CSDE), dated 2026-09-15:
  - `CVAP_by_Precinct_Race_2010-2025_2026-09-15.csv`
  - `CVAP_by_LD_Race_2026-09-15.csv`
- **Precinct boundaries** from the Washington Secretary of State, one statewide file per general election, 2010 and 2012–2025 ([precinct shapefiles](https://www.sos.wa.gov/elections/data-research/election-data-and-maps/reports-data-and-statistics/precinct-shapefiles)). Unzip each into `p<year>/`. 2011 isn't published, so 2011 uses 2012 lines, which match its precinct list exactly.
- **Legislative district and county boundaries** from Census cartographic boundary files: `cb_2018_53_sldu_500k` (2012 map), `cb_2022_53_sldu_500k` (2022 map), `cb_2024_53_sldu_500k` (2024 remedial map) and `cb_2024_us_county_500k`.

## Run

```
npm install mapshaper@0.6.102 topojson-server@3.0.1
node prep-geo.js <raw folder> <geo-norm folder> <path to mapshaper>
node --max-old-space-size=8000 build-data.js <geo-norm folder> <precinct csv> <LD csv> ../data <path to topojson-server>
```

## What the build does

1. **Prep:** reprojects every precinct file to WGS84 and simplifies lines to about 10 m. It also records each precinct's area and an interior point.
2. **Match precincts to the CVAP table.**
   - The ID field differs by year, and 2015 is 39 separate county files. For each county and year, the build tries every field as a precinct number and as a precinct name, then uses the field that matches the most distinct precincts.
   - Two data quirks are handled: Spokane 2014 rows carry the precinct code in the name column, and Pierce 2018 codes are malformed (`PI0002-101`).
   - Rows with the same code are slivers of one precinct, so they're summed.
3. **Fill gaps.** Where a year's file lacks a precinct, the build borrows that precinct's lines from the nearest year and flags it (`b`). That covers Pierce 2015 (the source file has geometry for only 17 of 508 precincts), Asotin 2015 and a few dozen precincts elsewhere. After filling, 99.8–100% of eligible citizens are mapped in every year.
4. **Work out which district map each district-table year uses.** The build adds up precincts into each candidate map and keeps the closest fit:
   - 2016–2019: 2012 map
   - 2020–2021: 2022 map
   - 2022–2025: 2024 map

   The table is labeled by survey release, not election year. Please confirm this with the researchers.
5. **Derived tables:**
   - **Today's district lines:** every year's precincts added up inside the 2024 map (`ldNow`), so district trends compare the same area.
   - **Redistricting moves:** for today's residents, the district they were in under the previous map.
   - **Location history:** for each 2025 precinct, the precinct that held its interior point in each earlier year, with a flag for whether the lines were about the same (same code, area within 3%).

## Output (`../data/`)

| File | Contents |
|---|---|
| `summary.json` | County and state totals by year, the district table, map eras, county-to-district lists, `ldNow`, redistricting moves, and the match report |
| `counties.json`, `ld-2012.json`, `ld-2022.json`, `ld-2024.json` | TopoJSON boundaries |
| `p/<year>/<county>.json` | Precinct TopoJSON. Properties: `id`, `n` (name), `v` (values), `a` (km²), `p` (interior point), `d` (district that election year), `b` (borrowed-from year) |
| `h/<county>.json` | Location histories for 2025 precincts |
| `s/<year>.json` | Statewide precinct values, for "precincts like this one" |

Value order everywhere: total, Hispanic or Latino, then non-Hispanic White, Black, Asian, American Indian or Alaska Native, Native Hawaiian or Pacific Islander, and two or more races. "Two or more races" sums the source's AIAN+White, Asian+White, Black+White, AIAN+Black and remainder columns.

## Adding registrant and voter data later

Join on the same normalized precinct ID (`St_Code` style, county code plus 8 digits) and year, and add columns to `v`. Turnout as a share of CVAP is then one division in the page. Registration and voting counts by race would need the researchers' method, since voter files don't record race.
