-- Add geolocation fields to branches table
ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude  double precision;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS service_radius_km integer DEFAULT 10;
