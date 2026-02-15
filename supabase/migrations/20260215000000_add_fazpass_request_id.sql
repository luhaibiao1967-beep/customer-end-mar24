-- Add request_id for Fazpass OTP validation (some APIs require it)
ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS request_id text;
