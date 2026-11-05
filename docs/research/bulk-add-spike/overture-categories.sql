-- Per-category view over the Brooklyn extract (overture/brooklyn.parquet).
CREATE OR REPLACE VIEW cat AS
SELECT *, CASE
  WHEN brand.wikidata = 'Q1046951' OR names.primary ILIKE 'target' THEN 'target'
  WHEN basic_category = 'museum' THEN 'museum'
  WHEN basic_category = 'hotel' THEN 'hotel'
  WHEN taxonomy.primary LIKE '%grocery_store' THEN 'grocery'
  WHEN taxonomy.primary = 'department_store' THEN 'department'
  WHEN taxonomy.primary = 'gas_station' OR basic_category = 'fueling_station' THEN 'gas'
END AS category
FROM 'overture/brooklyn.parquet';
