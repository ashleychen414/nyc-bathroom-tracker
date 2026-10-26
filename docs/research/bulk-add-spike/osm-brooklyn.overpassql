[out:json][timeout:180];
area(id:3600369518)->.bk; // OSM relation 369518 = Kings County, NY (Brooklyn). Not by name: Kings County, CA exists too.
(
  nwr["tourism"="museum"](area.bk);
  nwr["tourism"~"^(hotel|motel)$"](area.bk);
  nwr["shop"="supermarket"](area.bk);
  nwr["shop"="department_store"](area.bk);
  nwr["brand:wikidata"="Q1046951"](area.bk);
  nwr["amenity"="fuel"](area.bk);
);
out center tags meta;
