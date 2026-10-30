-- Overture Places, release 2026-10-21.0, Brooklyn bounding box, then clipped to the borough polygon.
INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
CREATE TABLE bk_poly AS SELECT geom FROM ST_Read('nyc/boroughs.geojson') WHERE boroname='Brooklyn';
CREATE TABLE ov AS
SELECT p.* FROM read_parquet('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*', hive_partitioning=1) p
WHERE p.bbox.xmin BETWEEN -74.05 AND -73.83 AND p.bbox.ymin BETWEEN 40.56 AND 40.74;
CREATE TABLE ov_bk AS SELECT ov.* FROM ov, bk_poly WHERE ST_Within(ov.geometry, bk_poly.geom);
COPY ov_bk TO 'overture/brooklyn.parquet' (FORMAT parquet);
SELECT count(*) AS bbox_rows FROM ov; SELECT count(*) AS brooklyn_rows FROM ov_bk;
