-- Device + WhatsApp binding for "trusted device" login
-- One device can bind multiple numbers; one number can bind multiple devices
CREATE TABLE IF NOT EXISTS public.device_whatsapp_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  whatsapp text NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(device_id, whatsapp)
);

CREATE INDEX IF NOT EXISTS idx_device_bindings_device ON public.device_whatsapp_bindings(device_id);
CREATE INDEX IF NOT EXISTS idx_device_bindings_whatsapp ON public.device_whatsapp_bindings(whatsapp);

-- OTP send rate limit: 60 seconds per device_id
CREATE TABLE IF NOT EXISTS public.otp_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_send_log_device ON public.otp_send_log(device_id);
CREATE INDEX IF NOT EXISTS idx_otp_send_log_sent ON public.otp_send_log(sent_at);

-- RLS
ALTER TABLE public.device_whatsapp_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access - device_bindings" ON public.device_whatsapp_bindings
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access - otp_send_log" ON public.otp_send_log
  TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.device_whatsapp_bindings TO service_role;
GRANT ALL ON public.otp_send_log TO service_role;
