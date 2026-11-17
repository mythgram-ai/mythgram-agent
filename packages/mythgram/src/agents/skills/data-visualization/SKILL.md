---
name: data-visualization
description: "Turns datasets and analytical results into clear, accurate, accessible charts, dashboards, and visual explanations. Use when users ask to explore, analyze, or visualize data."
---
# Data Visualization

## Mission
Help users understand data through truthful, readable, decision-oriented visualizations. Choose visual encodings that match the analytical question and preserve the integrity of the data.

## Workflow
1. **Understand the question**
   - Identify the audience, decision or insight sought, key measures, dimensions, time range, and desired output (chart, dashboard, report, or explanation).
   - Determine whether the task is descriptive, comparative, temporal, distributional, relational, or geographic.
2. **Inspect the data**
   - Check schema, units, types, row count, missingness, duplicates, outliers, and data quality.
   - Confirm definitions, denominators, aggregation level, and time zone where relevant.
   - Never silently discard records or impute values. Document transformations and assumptions.
3. **Choose an appropriate visual**
   - Comparison: bars/dots; use grouped or stacked bars only when composition matters.
   - Trend: line or area charts for ordered time; avoid connecting unrelated categories.
   - Distribution: histogram, box plot, violin, or density plot as appropriate.
   - Relationship: scatterplot, optionally with a clearly described trend line.
   - Composition: stacked bars or carefully limited part-to-whole charts; avoid pie charts with many categories.
   - Geography: map only when location is analytically meaningful and geographic data is reliable.
   - Use tables for exact lookup and charts for patterns.
4. **Design**
   - Give every chart a descriptive title, labeled axes, units, legend where needed, and useful annotations.
   - Use honest scales; disclose truncated axes and avoid misleading 3D effects.
   - Use consistent units, ordering, and color meaning across a dashboard.
   - Choose colorblind-aware palettes and do not encode meaning by color alone.
   - Keep labels legible, reduce clutter, and provide accessible text summaries.
5. **Analyze**
   - Separate observed facts from interpretations and causal claims.
   - Note sample size, uncertainty, missing data, and caveats where they affect interpretation.
   - Avoid implying causation from correlation.
6. **Deliver**
   - Provide the visualization in the requested format and a concise explanation of the main insight.
   - Include reproducible code or transformation notes when useful.

## Quality checklist
- [ ] Chart type matches the question and data.
- [ ] Aggregations and units are correct.
- [ ] Missing values and exclusions are disclosed.
- [ ] Axes, scales, labels, and legends are clear.
- [ ] Colors are consistent and accessible.
- [ ] No decorative 3D or misleading visual encoding.
- [ ] Important insight and caveats are stated in plain language.
- [ ] Visualization can be reproduced from the source data.

## Avoid
- Do not fabricate values, labels, or data sources.
- Do not smooth, normalize, or aggregate without explaining it.
- Do not use dual axes unless there is a compelling reason and the relationship is clearly explained.
- Do not overstate precision or statistical significance.
