


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_voucher_balance"("p_customer_id" "uuid", "p_vouchers_needed" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_balance INTEGER;
    v_customer_type VARCHAR(20);
BEGIN
    SELECT voucher_balance, customer_type 
    INTO v_balance, v_customer_type
    FROM customers 
    WHERE id = p_customer_id;
    
    -- later_pay customers don't need vouchers
    IF v_customer_type = 'later_pay' THEN
        RETURN TRUE;
    END IF;
    
    -- pre_pay customers need sufficient vouchers
    RETURN v_balance >= p_vouchers_needed;
END;
$$;


ALTER FUNCTION "public"."check_voucher_balance"("p_customer_id" "uuid", "p_vouchers_needed" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_vouchers"("p_customer_id" "uuid", "p_vouchers" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_customer_type VARCHAR(20);
BEGIN
    SELECT customer_type INTO v_customer_type
    FROM customers 
    WHERE id = p_customer_id;
    
    -- Only deduct for pre_pay customers
    IF v_customer_type = 'pre_pay' THEN
        UPDATE customers 
        SET voucher_balance = voucher_balance - p_vouchers
        WHERE id = p_customer_id
        AND voucher_balance >= p_vouchers;
        
        RETURN FOUND;
    END IF;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."deduct_vouchers"("p_customer_id" "uuid", "p_vouchers" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_old_otps"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM auth_otps WHERE created_at < now() - interval '24 hours';
END;
$$;


ALTER FUNCTION "public"."delete_old_otps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."regenerate_auth_token"("customer_id_param" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  new_token uuid;
BEGIN
  new_token := gen_random_uuid();
  
  UPDATE customers
  SET 
    auth_token = new_token,
    token_created_at = now()
  WHERE id = customer_id_param;
  
  RETURN new_token;
END;
$$;


ALTER FUNCTION "public"."regenerate_auth_token"("customer_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auth_otps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "otp" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "verified_at" timestamp with time zone,
    CONSTRAINT "auth_otps_phone_idx" CHECK (("char_length"("phone") >= 10))
);


ALTER TABLE "public"."auth_otps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "branches_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."customer_order_history" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::"uuid" AS "customer_id",
    NULL::"text" AS "customer_name",
    NULL::"date" AS "delivery_date",
    NULL::"text" AS "status",
    NULL::"text" AS "payment_status",
    NULL::integer AS "total_amount",
    NULL::timestamp with time zone AS "created_at",
    NULL::bigint AS "item_count",
    NULL::bigint AS "total_quantity";


ALTER VIEW "public"."customer_order_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "address" "text",
    "phone" "text",
    "whatsapp" "text" NOT NULL,
    "discount" integer DEFAULT 0,
    "branch" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "payment_term" "text" DEFAULT 'daily'::"text",
    "customer_type" character varying(20) DEFAULT 'pre_paid'::character varying,
    "voucher_balance" integer DEFAULT 0,
    "auth_user_id" "uuid",
    "auth_token" "uuid" DEFAULT "gen_random_uuid"(),
    "token_created_at" timestamp with time zone DEFAULT "now"(),
    "last_login_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    CONSTRAINT "customers_customer_type_check" CHECK ((("customer_type")::"text" = ANY ((ARRAY['pre_paid'::character varying, 'later_paid'::character varying])::"text"[]))),
    CONSTRAINT "customers_payment_term_check" CHECK (("payment_term" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'biweekly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."customer_type" IS 'pre_pay: Must have voucher_balance > 0 to order. later_pay: Can order with unpaid status (corporate accounts)';



COMMENT ON COLUMN "public"."customers"."voucher_balance" IS 'Number of available delivery vouchers. 1 voucher = 1 product delivery';



COMMENT ON COLUMN "public"."customers"."auth_user_id" IS 'Links customer to Supabase Auth user. Set during registration via WhatsApp OTP';



CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product" "text" NOT NULL,
    "is_refill" boolean DEFAULT false,
    "quantity" integer NOT NULL,
    "unit_price" integer NOT NULL,
    "discount" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "customer_name" "text" NOT NULL,
    "customer_address" "text" NOT NULL,
    "customer_whatsapp" "text" NOT NULL,
    "customer_discount" integer DEFAULT 0,
    "branch" "text" NOT NULL,
    "total_amount" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "payment_status" "text" DEFAULT 'unpaid'::"text",
    "payment_evidence" "text",
    "paid_date" "date",
    "delivery_date" "date" NOT NULL,
    "delivery_evidence" "text",
    "delivered_date" "date",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "empty_gallons_returned" integer DEFAULT 0,
    "borrowed_gallons" integer DEFAULT 0,
    "delivery_notes" "text",
    CONSTRAINT "orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'paid'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'scheduled'::"text", 'delivered'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."payment_status" IS 'paid (pre_pay after voucher deduction), unpaid (later_pay accounts), pending (awaiting QRIS payment)';



CREATE TABLE IF NOT EXISTS "public"."payment_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "transaction_id" character varying(100) NOT NULL,
    "amount" integer NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "payment_type" character varying(20) DEFAULT 'qris'::character varying,
    "vouchers_purchased" integer NOT NULL,
    "package_type" character varying(20),
    "midtrans_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payment_transactions_package_type_check" CHECK ((("package_type")::"text" = ANY ((ARRAY['single'::character varying, 'package_10'::character varying, 'package_20'::character varying, 'package_50'::character varying])::"text"[]))),
    CONSTRAINT "payment_transactions_payment_type_check" CHECK ((("payment_type")::"text" = ANY ((ARRAY['qris'::character varying, 'bank_transfer'::character varying, 'cash'::character varying])::"text"[]))),
    CONSTRAINT "payment_transactions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'success'::character varying, 'failed'::character varying, 'expired'::character varying])::"text"[])))
);


ALTER TABLE "public"."payment_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_transactions" IS 'Tracks all QRIS payment transactions from Midtrans. Updated by webhook on payment confirmation';



COMMENT ON COLUMN "public"."payment_transactions"."package_type" IS 'single (Rp 15k), package_10 (Rp 140k), package_20 (Rp 270k), package_50 (Rp 650k)';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "price" integer NOT NULL,
    "unit" "text" NOT NULL,
    "is_refill" boolean DEFAULT false,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "products_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "branch" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "username" "text",
    "phone" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'sales'::"text", 'operator'::"text", 'finance'::"text"]))),
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "trip_date" "date" NOT NULL,
    "driver" "text",
    "branch" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "order_ids" "text"[] DEFAULT ARRAY[]::"text"[],
    CONSTRAINT "trips_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in-progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."trips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "phone" "text" NOT NULL,
    "message_type" "text" NOT NULL,
    "message_content" "text",
    "status" "text" DEFAULT 'sent'::"text",
    "provider_response" "jsonb",
    "order_id" "uuid",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "message_type_check" CHECK (("message_type" = ANY (ARRAY['otp'::"text", 'welcome'::"text", 'order_confirmation'::"text", 'promo'::"text", 'resend_link'::"text"])))
);


ALTER TABLE "public"."whatsapp_messages" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auth_otps"
    ADD CONSTRAINT "auth_otps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_auth_token_key" UNIQUE ("auth_token");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_transaction_id_key" UNIQUE ("transaction_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."trips"
    ADD CONSTRAINT "trips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_messages"
    ADD CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_auth_otps_expires" ON "public"."auth_otps" USING "btree" ("expires_at");



CREATE INDEX "idx_auth_otps_phone" ON "public"."auth_otps" USING "btree" ("phone");



CREATE UNIQUE INDEX "idx_customers_auth_token" ON "public"."customers" USING "btree" ("auth_token") WHERE ("auth_token" IS NOT NULL);



CREATE INDEX "idx_customers_auth_user_id" ON "public"."customers" USING "btree" ("auth_user_id");



CREATE INDEX "idx_customers_customer_type" ON "public"."customers" USING "btree" ("customer_type");



CREATE INDEX "idx_customers_payment_term" ON "public"."customers" USING "btree" ("payment_term");



CREATE UNIQUE INDEX "idx_customers_whatsapp" ON "public"."customers" USING "btree" ("whatsapp");



CREATE INDEX "idx_orders_payment_status" ON "public"."orders" USING "btree" ("payment_status");



CREATE INDEX "idx_payment_transactions_created_at" ON "public"."payment_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_payment_transactions_customer_id" ON "public"."payment_transactions" USING "btree" ("customer_id");



CREATE INDEX "idx_payment_transactions_status" ON "public"."payment_transactions" USING "btree" ("status");



CREATE INDEX "idx_payment_transactions_transaction_id" ON "public"."payment_transactions" USING "btree" ("transaction_id");



CREATE INDEX "idx_profiles_phone" ON "public"."profiles" USING "btree" ("phone");



CREATE INDEX "idx_profiles_username" ON "public"."profiles" USING "btree" ("username");



CREATE INDEX "idx_whatsapp_messages_customer" ON "public"."whatsapp_messages" USING "btree" ("customer_id");



CREATE INDEX "idx_whatsapp_messages_order" ON "public"."whatsapp_messages" USING "btree" ("order_id");



CREATE INDEX "idx_whatsapp_messages_sent" ON "public"."whatsapp_messages" USING "btree" ("sent_at");



CREATE INDEX "idx_whatsapp_messages_type" ON "public"."whatsapp_messages" USING "btree" ("message_type");



CREATE OR REPLACE VIEW "public"."customer_order_history" AS
 SELECT "o"."id",
    "o"."customer_id",
    "o"."customer_name",
    "o"."delivery_date",
    "o"."status",
    "o"."payment_status",
    "o"."total_amount",
    "o"."created_at",
    "count"("oi"."id") AS "item_count",
    "sum"("oi"."quantity") AS "total_quantity"
   FROM ("public"."orders" "o"
     LEFT JOIN "public"."order_items" "oi" ON (("o"."id" = "oi"."order_id")))
  GROUP BY "o"."id";



CREATE OR REPLACE TRIGGER "update_payment_transactions_updated_at" BEFORE UPDATE ON "public"."payment_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."whatsapp_messages"
    ADD CONSTRAINT "whatsapp_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_messages"
    ADD CONSTRAINT "whatsapp_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



CREATE POLICY "Allow customers to create orders" ON "public"."orders" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow customers to read own orders" ON "public"."orders" FOR SELECT USING ((("customer_id" = "auth"."uid"()) OR true));



CREATE POLICY "Allow public to insert order_items" ON "public"."order_items" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public to read order_items" ON "public"."order_items" FOR SELECT USING (true);



CREATE POLICY "Anyone can view active products" ON "public"."products" FOR SELECT USING (("status" = 'active'::"text"));



CREATE POLICY "No public access - auth_otps" ON "public"."auth_otps" USING (false);



CREATE POLICY "No public access - whatsapp_messages" ON "public"."whatsapp_messages" USING (false);



CREATE POLICY "No public access to OTPs" ON "public"."auth_otps" USING (false);



CREATE POLICY "Service role full access - auth_otps" ON "public"."auth_otps" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access - whatsapp_messages" ON "public"."whatsapp_messages" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "System can update payment transactions" ON "public"."payment_transactions" FOR UPDATE USING (true);



CREATE POLICY "Users can insert items for their orders" ON "public"."order_items" FOR INSERT WITH CHECK (("order_id" IN ( SELECT "o"."id"
   FROM ("public"."orders" "o"
     JOIN "public"."customers" "c" ON (("o"."customer_id" = "c"."id")))
  WHERE ("c"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own customer profile" ON "public"."customers" FOR INSERT WITH CHECK (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own orders" ON "public"."orders" FOR INSERT WITH CHECK (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own payment transactions" ON "public"."payment_transactions" FOR INSERT WITH CHECK (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update their own customer profile" ON "public"."customers" FOR UPDATE USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Users can view items of their orders" ON "public"."order_items" FOR SELECT USING (("order_id" IN ( SELECT "o"."id"
   FROM ("public"."orders" "o"
     JOIN "public"."customers" "c" ON (("o"."customer_id" = "c"."id")))
  WHERE ("c"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own customer profile" ON "public"."customers" FOR SELECT USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own orders" ON "public"."orders" FOR SELECT USING (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own payment transactions" ON "public"."payment_transactions" FOR SELECT USING (("customer_id" IN ( SELECT "customers"."id"
   FROM "public"."customers"
  WHERE ("customers"."auth_user_id" = "auth"."uid"()))));



ALTER TABLE "public"."auth_otps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_insert_customers" ON "public"."customers" FOR INSERT WITH CHECK (true);



CREATE POLICY "public_select_customers" ON "public"."customers" FOR SELECT USING (true);



ALTER TABLE "public"."whatsapp_messages" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."check_voucher_balance"("p_customer_id" "uuid", "p_vouchers_needed" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_voucher_balance"("p_customer_id" "uuid", "p_vouchers_needed" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_voucher_balance"("p_customer_id" "uuid", "p_vouchers_needed" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_vouchers"("p_customer_id" "uuid", "p_vouchers" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_vouchers"("p_customer_id" "uuid", "p_vouchers" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_vouchers"("p_customer_id" "uuid", "p_vouchers" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_old_otps"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_old_otps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_old_otps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."regenerate_auth_token"("customer_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."regenerate_auth_token"("customer_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regenerate_auth_token"("customer_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."auth_otps" TO "anon";
GRANT ALL ON TABLE "public"."auth_otps" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_otps" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."customer_order_history" TO "anon";
GRANT ALL ON TABLE "public"."customer_order_history" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_order_history" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."trips" TO "anon";
GRANT ALL ON TABLE "public"."trips" TO "authenticated";
GRANT ALL ON TABLE "public"."trips" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_messages" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_messages" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

alter table "public"."customers" drop constraint "customers_customer_type_check";

alter table "public"."payment_transactions" drop constraint "payment_transactions_package_type_check";

alter table "public"."payment_transactions" drop constraint "payment_transactions_payment_type_check";

alter table "public"."payment_transactions" drop constraint "payment_transactions_status_check";

alter table "public"."customers" add constraint "customers_customer_type_check" CHECK (((customer_type)::text = ANY ((ARRAY['pre_paid'::character varying, 'later_paid'::character varying])::text[]))) not valid;

alter table "public"."customers" validate constraint "customers_customer_type_check";

alter table "public"."payment_transactions" add constraint "payment_transactions_package_type_check" CHECK (((package_type)::text = ANY ((ARRAY['single'::character varying, 'package_10'::character varying, 'package_20'::character varying, 'package_50'::character varying])::text[]))) not valid;

alter table "public"."payment_transactions" validate constraint "payment_transactions_package_type_check";

alter table "public"."payment_transactions" add constraint "payment_transactions_payment_type_check" CHECK (((payment_type)::text = ANY ((ARRAY['qris'::character varying, 'bank_transfer'::character varying, 'cash'::character varying])::text[]))) not valid;

alter table "public"."payment_transactions" validate constraint "payment_transactions_payment_type_check";

alter table "public"."payment_transactions" add constraint "payment_transactions_status_check" CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'success'::character varying, 'failed'::character varying, 'expired'::character varying])::text[]))) not valid;

alter table "public"."payment_transactions" validate constraint "payment_transactions_status_check";


  create policy "Operators can upload delivery evidence 1v8k1e8_0"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'delivery-evidence'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['operator'::text, 'admin'::text])))))));



  create policy "Operators can upload delivery evidence 1v8k1e8_1"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'delivery-evidence'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['operator'::text, 'admin'::text])))))));



  create policy "all public access 1v8k1e8_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'delivery-evidence'::text));



  create policy "allow for photo uploading and review 1s40g8u_0"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'payment-evidence'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['sales'::text, 'finance'::text, 'admin'::text])))))));



  create policy "allow for photo uploading and review 1s40g8u_1"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'payment-evidence'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['sales'::text, 'finance'::text, 'admin'::text])))))));


CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


