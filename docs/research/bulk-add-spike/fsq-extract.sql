-- Foursquare OS Places, public Fused mirror on Source Cooperative (release 2025-02-06), Brooklyn bbox.
INSTALL httpfs; LOAD httpfs;
CREATE SECRET sc (TYPE s3, ENDPOINT 'data.source.coop', URL_STYLE 'path', KEY_ID '', SECRET '', REGION 'us-west-2');
COPY (SELECT * FROM read_parquet('s3://fused/fsq-os-places/2025-02-06/places/*.parquet')
      WHERE latitude BETWEEN 40.56 AND 40.74 AND longitude BETWEEN -74.05 AND -73.83)
TO 'fsq/brooklyn_bbox.parquet' (FORMAT parquet);
