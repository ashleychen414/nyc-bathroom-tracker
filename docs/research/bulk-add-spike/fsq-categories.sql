-- Clip to Brooklyn and tag categories by Foursquare category label.
INSTALL spatial; LOAD spatial;
CREATE TABLE bk_poly AS SELECT geom FROM ST_Read('nyc/boroughs.geojson') WHERE boroname='Brooklyn';
CREATE TABLE f AS SELECT p.*, CASE
  WHEN name ILIKE 'target' OR name ILIKE 'target store%' THEN 'target'
  WHEN list_contains(fsq_category_labels, 'Arts and Entertainment > Museum') OR list_has_any(fsq_category_labels, (SELECT list(l) FROM (SELECT DISTINCT unnest(fsq_category_labels) l FROM 'fsq/brooklyn_bbox.parquet') WHERE l LIKE '%> Museum >%' OR l LIKE '%> Museum')) THEN 'museum'
  WHEN list_has_any(fsq_category_labels, ['Travel and Transportation > Lodging > Hotel', 'Travel and Transportation > Lodging > Motel', 'Travel and Transportation > Lodging > Boutique Hotel']) THEN 'hotel'
  WHEN list_has_any(fsq_category_labels, ['Retail > Food and Beverage Retail > Grocery Store', 'Retail > Food and Beverage Retail > Supermarket']) THEN 'grocery'
  WHEN list_contains(fsq_category_labels, 'Retail > Department Store') THEN 'department'
  WHEN list_contains(fsq_category_labels, 'Travel and Transportation > Fuel Station') THEN 'gas'
END AS category
FROM 'fsq/brooklyn_bbox.parquet' p, bk_poly WHERE ST_Within(ST_Point(longitude, latitude), bk_poly.geom);
COPY (SELECT fsq_place_id, name, latitude, longitude, address, category, date_refreshed, date_closed FROM f WHERE category IS NOT NULL) TO 'fsq/brooklyn_cats.parquet' (FORMAT parquet);
