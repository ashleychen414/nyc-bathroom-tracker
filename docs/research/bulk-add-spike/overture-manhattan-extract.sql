-- Overture Places, release 2026-10-21.0, Manhattan bounding box clipped to the borough (run from the work folder).
INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
CREATE TABLE mn_poly AS SELECT geom FROM ST_Read('nyc/boroughs.geojson') WHERE boroname='Manhattan';
CREATE TABLE ov AS
SELECT p.* FROM read_parquet('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*', hive_partitioning=1) p
WHERE p.bbox.xmin BETWEEN -74.03 AND -73.90 AND p.bbox.ymin BETWEEN 40.68 AND 40.89;
CREATE TABLE ov_mn AS SELECT ov.* FROM ov, mn_poly WHERE ST_Within(ov.geometry, mn_poly.geom);
COPY ov_mn TO 'overture/manhattan.parquet' (FORMAT parquet);
