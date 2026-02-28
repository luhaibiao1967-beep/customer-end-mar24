-- Fix WhatsApp numbers from local format (08XXXXXXXX) to international format (+628XXXXXXXX)
-- Preview: count affected rows
-- SELECT COUNT(*) FROM customers WHERE whatsapp LIKE '0%';

UPDATE customers
SET whatsapp = '+62' || SUBSTRING(whatsapp FROM 2)
WHERE whatsapp LIKE '0%';
