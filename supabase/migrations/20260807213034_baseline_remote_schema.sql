-- Baseline: production şemasının tam anlık görüntüsü (project ref: lubqjfyumqlkippeijah).
-- `supabase db dump --schema public` ile üretildi, 2026-08-07 21:30 UTC.
-- Bu dosya tek başına public şemasını sıfırdan kurar.
-- Elle düzenleme; şema değişikliği için YENİ bir migration ekle.




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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."set_user_preferences_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_user_preferences_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_user_works"("p_type" "text", "p_batch_id" "uuid", "p_works" "jsonb") RETURNS "uuid"[]
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  UUID[] := '{}';
  w         JSONB;
  v_creator TEXT;
  v_title   TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok';
  END IF;

  FOR w IN SELECT * FROM jsonb_array_elements(p_works)
  LOOP
    v_creator := nullif(btrim(coalesce(w->>'creator', '')), '');
    v_title   := nullif(btrim(coalesce(w->>'title', '')), '');

    IF v_creator IS NULL AND v_title IS NULL THEN
      CONTINUE;
    END IF;

    SELECT uw.id INTO v_id
    FROM user_works uw
    WHERE uw.user_id = v_user_id
      AND uw.type = p_type
      AND uw.deleted_at IS NULL
      AND lower(coalesce(uw.creator, '')) = lower(coalesce(v_creator, ''))
      AND lower(coalesce(uw.title, ''))   = lower(coalesce(v_title, ''))
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO user_works (user_id, type, creator, title, source, confidence, batch_id)
      VALUES (v_user_id, p_type, v_creator, v_title, w->>'source',
              nullif(w->>'confidence', ''), p_batch_id)
      RETURNING id INTO v_id;
    END IF;

    v_result := v_result || v_id;
  END LOOP;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."upsert_user_works"("p_type" "text", "p_batch_id" "uuid", "p_works" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."daily_discoveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "report_id" "uuid",
    "book" "text" NOT NULL,
    "film" "text" NOT NULL,
    "music" "text" NOT NULL,
    "reasons" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_discoveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_works" (
    "report_id" "uuid" NOT NULL,
    "work_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."report_works" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "telegram_user_id" bigint,
    "books" "jsonb",
    "films" "jsonb",
    "songs" "jsonb",
    "hero" "jsonb",
    "texture" "jsonb",
    "threads" "jsonb",
    "contrasts" "jsonb",
    "shadow" "jsonb",
    "is_public" boolean DEFAULT true,
    "source" "text" DEFAULT 'telegram'::"text",
    "user_id" "uuid"
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_link_codes" (
    "code" "text" NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."telegram_link_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_users" (
    "telegram_user_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."telegram_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "weekly_picks_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_works" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "telegram_user_id" bigint,
    "type" "text" NOT NULL,
    "creator" "text",
    "title" "text",
    "source" "text" NOT NULL,
    "batch_id" "uuid",
    "confidence" "text",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_works_confidence_check" CHECK (("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "user_works_needs_name" CHECK ((("creator" IS NOT NULL) OR ("title" IS NOT NULL))),
    CONSTRAINT "user_works_source_check" CHECK (("source" = ANY (ARRAY['screenshot'::"text", 'paste'::"text", 'manual'::"text", 'form'::"text"]))),
    CONSTRAINT "user_works_type_check" CHECK (("type" = ANY (ARRAY['book'::"text", 'film'::"text", 'song'::"text"])))
);


ALTER TABLE "public"."user_works" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week" "date" NOT NULL,
    "films" "jsonb" NOT NULL,
    "intro_variant" "text" DEFAULT 'standart'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weekly_picks_intro_variant_check" CHECK (("intro_variant" = ANY (ARRAY['standart'::"text", 'sessiz'::"text"]))),
    CONSTRAINT "weekly_picks_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'failed'::"text", 'overpast'::"text"])))
);


ALTER TABLE "public"."weekly_picks" OWNER TO "postgres";


ALTER TABLE ONLY "public"."daily_discoveries"
    ADD CONSTRAINT "daily_discoveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_discoveries"
    ADD CONSTRAINT "daily_discoveries_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."report_works"
    ADD CONSTRAINT "report_works_pkey" PRIMARY KEY ("report_id", "work_id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_link_codes"
    ADD CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."telegram_users"
    ADD CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("telegram_user_id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_works"
    ADD CONSTRAINT "user_works_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_picks"
    ADD CONSTRAINT "weekly_picks_one_per_week" UNIQUE ("user_id", "week");



ALTER TABLE ONLY "public"."weekly_picks"
    ADD CONSTRAINT "weekly_picks_pkey" PRIMARY KEY ("id");



CREATE INDEX "report_works_work_id_idx" ON "public"."report_works" USING "btree" ("work_id");



CREATE INDEX "telegram_link_codes_expires_at_idx" ON "public"."telegram_link_codes" USING "btree" ("expires_at");



CREATE INDEX "user_works_batch_id_idx" ON "public"."user_works" USING "btree" ("batch_id");



CREATE INDEX "user_works_telegram_user_id_idx" ON "public"."user_works" USING "btree" ("telegram_user_id");



CREATE UNIQUE INDEX "user_works_unique_per_user" ON "public"."user_works" USING "btree" ("user_id", "type", "lower"(COALESCE("creator", ''::"text")), "lower"(COALESCE("title", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "user_works_user_type_created_idx" ON "public"."user_works" USING "btree" ("user_id", "type", "created_at" DESC);



CREATE INDEX "weekly_picks_week_status_idx" ON "public"."weekly_picks" USING "btree" ("week", "status");



CREATE OR REPLACE TRIGGER "user_preferences_set_updated_at" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_preferences_updated_at"();



ALTER TABLE ONLY "public"."daily_discoveries"
    ADD CONSTRAINT "daily_discoveries_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id");



ALTER TABLE ONLY "public"."daily_discoveries"
    ADD CONSTRAINT "daily_discoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."report_works"
    ADD CONSTRAINT "report_works_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_works"
    ADD CONSTRAINT "report_works_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."user_works"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."telegram_users"
    ADD CONSTRAINT "telegram_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_works"
    ADD CONSTRAINT "user_works_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."weekly_picks"
    ADD CONSTRAINT "weekly_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Herkese acik raporlari herkes okuyabilir" ON "public"."reports" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Kullanici kendi raporlarini okuyabilir" ON "public"."reports" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Kullanici kendi raporunu guncelleyebilir" ON "public"."reports" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Public reports are viewable by everyone" ON "public"."reports" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Users delete own works" ON "public"."user_works" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own preferences" ON "public"."user_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own works" ON "public"."user_works" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own discoveries" ON "public"."daily_discoveries" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own preferences" ON "public"."user_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own report links" ON "public"."report_works" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."reports" "r"
  WHERE (("r"."id" = "report_works"."report_id") AND ("r"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users see own weekly picks" ON "public"."weekly_picks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own works" ON "public"."user_works" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own preferences" ON "public"."user_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own works" ON "public"."user_works" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."daily_discoveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_works" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_link_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_works" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_picks" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_preferences_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_preferences_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_preferences_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_user_works"("p_type" "text", "p_batch_id" "uuid", "p_works" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_user_works"("p_type" "text", "p_batch_id" "uuid", "p_works" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_user_works"("p_type" "text", "p_batch_id" "uuid", "p_works" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."daily_discoveries" TO "anon";
GRANT ALL ON TABLE "public"."daily_discoveries" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_discoveries" TO "service_role";



GRANT ALL ON TABLE "public"."report_works" TO "anon";
GRANT ALL ON TABLE "public"."report_works" TO "authenticated";
GRANT ALL ON TABLE "public"."report_works" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_link_codes" TO "anon";
GRANT ALL ON TABLE "public"."telegram_link_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_link_codes" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_users" TO "anon";
GRANT ALL ON TABLE "public"."telegram_users" TO "authenticated";
GRANT ALL ON TABLE "public"."telegram_users" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_works" TO "anon";
GRANT ALL ON TABLE "public"."user_works" TO "authenticated";
GRANT ALL ON TABLE "public"."user_works" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_picks" TO "anon";
GRANT ALL ON TABLE "public"."weekly_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_picks" TO "service_role";



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







