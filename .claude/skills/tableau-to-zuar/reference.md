# tableau-to-zuar — reference

Detail for the [SKILL.md](SKILL.md) pipeline: the intermediate model, how to pull it out of the
`.twb` XML, how to emit each chart, and how to convert dashboard zones to a Zuar grid.

> **Parser status:** the XML element paths below are the standard Tableau layout, but `.twb` structure
> varies by Tableau version and viz. **Tune the extraction against a real sample `.twbx`** before
> trusting it. A deterministic parser script (Node + an XML lib such as `fast-xml-parser`) is more
> reliable than eyeballing the XML; build it once a sample is in hand.

## Normalized model (parser output → emitter input)
```jsonc
{
  "datasources": [
    { "name": "federated.x", "caption": "Sales",
      "fields": [
        { "name": "[region]", "caption": "Region", "role": "dimension", "datatype": "string" },
        { "name": "[sales]",  "caption": "Sales",  "role": "measure",   "datatype": "real",
          "calc": null }            // calc formula string if it's a calculated field (v1: not translated)
      ] }
  ],
  "worksheets": [
    { "name": "Sales by Region", "datasource": "federated.x", "mark": "bar",
      "dimensions": ["[region]"],
      "measures": [{ "field": "[sales]", "agg": "sum", "caption": "Sales" }],
      "encodings": { "color": "[segment]", "label": "[sales]" },
      "filters": [{ "field": "[region]", "kind": "categorical", "values": ["West","East"] }] }
  ],
  "dashboards": [
    { "name": "Exec Overview", "size": { "w": 1200, "h": 800 },
      "zones": [{ "worksheet": "Sales by Region", "x": 0, "y": 0, "w": 600, "h": 400 }],
      "filters": [{ "field": "[region]", "kind": "categorical", "appliesTo": ["Sales by Region"] }] }
  ]
}
```

## TWB extraction map (verify against your file)
- **Workbook root:** `<workbook>`.
- **Datasources:** `workbook/datasources/datasource` (`@name`, `@caption`). Fields:
  `datasource/column` (`@name`, `@caption`, `@role` = `dimension|measure`, `@datatype`); calculated
  field formula: `column/calculation/@formula`. Aggregation/instances: `column-instance`
  (`@derivation` = `Sum|Avg|Count|...`).
- **Worksheets:** `workbook/worksheets/worksheet` (`@name`). Data source used:
  `worksheet/table/view/datasource-dependencies/@datasource`. Shelves (field refs like
  `[ds].[field]`): `worksheet/table/rows` and `worksheet/table/cols`. Mark type:
  `worksheet/table/panes/pane/mark/@class` (`Bar|Line|Area|Pie|Circle|Text|Square|Automatic`).
  Encodings: `pane/encodings/*` (`color`, `size`, `text/label`, `lod`). Filters:
  `worksheet/table/view/filter` (`@class` = `categorical|quantitative`; values in nested
  `groupfilter`/`...`).
- **Dashboards:** `workbook/dashboards/dashboard` (`@name`). Size: `dashboard/size`
  (`@maxwidth`/`@maxheight`, or per-device `devicelayouts`). Zones (recursive):
  `dashboard/zones//zone` — each has `@x @y @w @h` and `@name` (the hosted worksheet) or a
  `@type` (e.g. a filter/text/legend zone). Skip legend/title/blank zones for v1.

## Zone → Zuar grid math
Tableau zone `x/y/w/h` are in the dashboard's coordinate space (commonly a `0..size` range, sometimes a
fixed 100000 grid — **confirm per file**). Convert to **percent** of the dashboard, which is exactly
what Zuar `block_layouts` expects (`sizingUnit:"%"`):
```
left   = x / size.w * 100
top    = y / size.h * 100
width  = w / size.w * 100
height = h / size.h * 100
```
Write the same box to `lg`; for `md`/`sm` either reuse it or stack full-width (see the MCP recipes).
Emit ONE `update_resource resource=layout` with the full `json_data.grid` (`blocks[]` +
`block_layouts.{lg,md,sm}`) — never parallel `add_block_to_page` calls.

## Worksheet → Zuar data mapping (the step-3 input)
One row per worksheet; confirm with the user (Tableau field names rarely equal Zuar query columns):
```jsonc
[
  { "worksheet": "Sales by Region",
    "zuar_query_id": "<uuid>",          // OR "zuar_datasource_id": "<uuid>"
    "dimension_cols": ["region"],        // real Zuar query column names
    "measure_cols": [{ "col": "sales", "agg": "sum", "label": "Sales" }] }
]
```
Aggregate in the bound query's SQL when the dataset is large; otherwise aggregate in the block JS from
`getQueryData()`.

## Chart emit templates (mark → ECharts)
Author each block per the MCP's `docs/04-authoring-blocks.md` + `docs/08-zportal-in-block-api.md`
scaffold (two fields, IIFE, `getQueryData`, AMD-safe `zPortal.resources.load` of ECharts, dispose on
re-render, theme `var(--color-*)`, `dataSource.on('load', DS_ID, render)` for filter reactivity, and
**no literal `$`**). Then pick the series by mark:

| Tableau mark | ECharts | Data shaping from `getQueryData()` |
|---|---|---|
| Bar | `type:'bar'` (horizontal: `xAxis` value + `yAxis` category) | group by dimension, aggregate the measure |
| Line / Area | `type:'line'` (`areaStyle:{}` for area) | dimension on category axis, measure as series |
| Pie / Donut | `type:'pie'` (`radius:['40%','70%']` for donut) | `{name: dim, value: measure}` per group |
| Scatter | `type:'scatter'` | two measures → `[x,y]`; encoding.color → series split |
| Text-table | HTML table (or native `data-table` block) | rows as-is; format numbers/currency |
| KPI / single value | stat card (no chart) | one aggregated number + label |
| Heatmap | `type:'heatmap'` + two category axes + `visualMap` | dim×dim grid, measure as value |
| Map / dual-axis / LOD | **flag — not auto-converted** | report worksheet name in the fidelity summary |

Color/label encodings: a Tableau **color** dimension → an ECharts series split or `visualMap`; a
**label** → `series.label.show:true` with currency/number formatting.

## Fidelity report (always produce)
End every conversion with: ✅ converted (worksheet → block + chart type), ⚠️ approximated (what
differs), ⛔ skipped (maps/LOD/dual-axis/etc. by worksheet name). Never let an unsupported viz vanish
silently.

## TODO before this is production-ready
- Build/finalize the `.twb` parser against ≥1 real `.twbx` (extraction map above is the starting point).
- Confirm the zone coordinate unit (size-relative vs 100000 grid) on real files.
- Decide multiselect vs single-select filter controls per Tableau filter type.
- (Later) optional v2: recreate datasources/queries from the workbook instead of mapping to existing.
