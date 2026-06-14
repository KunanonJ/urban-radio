CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"station_id" text,
	"actor_user_id" text,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"unit" text NOT NULL,
	"count" integer NOT NULL,
	"estimated_cost_usd" real NOT NULL,
	"request_summary" text,
	"at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "ai_usage_capability_check" CHECK ("ai_usage"."capability" IN ('voice','text','transcribe','anr')),
	CONSTRAINT "ai_usage_unit_check" CHECK ("ai_usage"."unit" IN ('tokens','characters','seconds','requests'))
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist_id" text NOT NULL,
	"artwork" text NOT NULL,
	"year" integer NOT NULL,
	"genre" text NOT NULL,
	"source" text NOT NULL,
	"date_added" text
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"artwork" text NOT NULL,
	"genres_json" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before_json" text,
	"after_json" text,
	"at" text DEFAULT (now() at time zone 'utc')::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "auth_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#888888',
	"repeat_protection_minutes" integer DEFAULT 0,
	"level_db" real DEFAULT 0,
	"suppress_title" integer DEFAULT 0,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "categories_station_id_name_key" UNIQUE("station_id","name")
);
--> statement-breakpoint
CREATE TABLE "clock_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"clock_id" text NOT NULL,
	"position" integer NOT NULL,
	"slot_type" text NOT NULL,
	"category_id" text,
	"duration_estimate_ms" integer NOT NULL,
	"rules_json" text,
	CONSTRAINT "clock_slots_clock_id_position_key" UNIQUE("clock_id","position"),
	CONSTRAINT "clock_slots_slot_type_check" CHECK ("clock_slots"."slot_type" IN ('music','sweeper','liner','vt','id','news','weather','spot','bed','custom'))
);
--> statement-breakpoint
CREATE TABLE "clocks" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6',
	"target_duration_ms" integer DEFAULT 3600000,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"body" text NOT NULL,
	"resolved_at" text,
	"resolved_by_user_id" text,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	"updated_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "comments_target_type_check" CHECK ("comments"."target_type" IN ('clock','clock_slot','schedule_assignment','voice_track','radio_track'))
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"r2_key" text NOT NULL,
	"track_id" text,
	"bytes" integer NOT NULL,
	"content_type" text,
	"content_hash" text,
	"created_at" text NOT NULL,
	CONSTRAINT "media_objects_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"billing_customer_id" text,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_log" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"track_id" text,
	"title_snapshot" text NOT NULL,
	"artist_snapshot" text,
	"played_at" text NOT NULL,
	"duration_played_ms" integer,
	"source" text NOT NULL,
	"isrc" text,
	"iswc" text,
	CONSTRAINT "play_log_source_check" CHECK ("play_log"."source" IN ('automation','manual','live_dj','voice_track','cart','spot','now_playing','auto_recognition'))
);
--> statement-breakpoint
CREATE TABLE "playlist_tracks" (
	"playlist_id" text NOT NULL,
	"track_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "playlist_tracks_playlist_id_track_id_pk" PRIMARY KEY("playlist_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"artwork" text NOT NULL,
	"created_by" text DEFAULT 'You' NOT NULL,
	"is_public" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"last_heartbeat_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "idx_presence_user_target" UNIQUE("station_id","user_id","target_type","target_id"),
	CONSTRAINT "presence_sessions_target_type_check" CHECK ("presence_sessions"."target_type" IN ('clock','clock_slot','schedule_assignment','voice_track','radio_track','schedule_cell'))
);
--> statement-breakpoint
CREATE TABLE "radio_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"category_id" text,
	"title" text NOT NULL,
	"artist" text,
	"album" text,
	"genre" text,
	"bpm" real,
	"music_key" text,
	"energy" integer,
	"era_year" integer,
	"language" text,
	"duration_ms" integer NOT NULL,
	"cue_in_ms" integer DEFAULT 0,
	"cue_out_ms" integer,
	"intro_ms" integer,
	"outro_ms" integer,
	"mix_point_ms" integer,
	"loudness_lufs" real,
	"file_type" text,
	"content_hash" text,
	"storage_key" text NOT NULL,
	"custom_f1" text,
	"custom_f2" text,
	"custom_f3" text,
	"custom_f4" text,
	"custom_f5" text,
	"rating" integer,
	"play_count" integer DEFAULT 0,
	"last_played_at" text,
	"date_added" text DEFAULT (now() at time zone 'utc')::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"clock_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"hour" integer NOT NULL,
	"valid_from" text,
	"valid_until" text,
	"rrule" text,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "schedule_assignments_weekday_check" CHECK ("schedule_assignments"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_assignments_hour_check" CHECK ("schedule_assignments"."hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
CREATE TABLE "station_members" (
	"station_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "station_members_station_id_user_id_pk" PRIMARY KEY("station_id","user_id"),
	CONSTRAINT "station_members_role_check" CHECK ("station_members"."role" IN ('operator','producer','programmer','admin','guest_vt'))
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"stream_url" text,
	"language" text DEFAULT 'en',
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "stations_org_id_slug_key" UNIQUE("org_id","slug")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist_id" text NOT NULL,
	"album_id" text NOT NULL,
	"duration" integer NOT NULL,
	"artwork" text NOT NULL,
	"source" text NOT NULL,
	"genre" text NOT NULL,
	"year" integer NOT NULL,
	"track_number" integer DEFAULT 1 NOT NULL,
	"date_added" text,
	"media_r2_key" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "voice_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"recorded_by" text,
	"storage_key" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"transcript" text,
	"target_clock_slot_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"ai_generated" integer DEFAULT 0,
	"created_at" text DEFAULT (now() at time zone 'utc')::text NOT NULL,
	CONSTRAINT "voice_tracks_status_check" CHECK ("voice_tracks"."status" IN ('draft','ready','aired','archived'))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_slots" ADD CONSTRAINT "clock_slots_clock_id_clocks_id_fk" FOREIGN KEY ("clock_id") REFERENCES "public"."clocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_slots" ADD CONSTRAINT "clock_slots_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clocks" ADD CONSTRAINT "clocks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_auth_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_user_id_auth_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_log" ADD CONSTRAINT "play_log_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_sessions" ADD CONSTRAINT "presence_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_sessions" ADD CONSTRAINT "presence_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_tracks" ADD CONSTRAINT "radio_tracks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_tracks" ADD CONSTRAINT "radio_tracks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignments" ADD CONSTRAINT "schedule_assignments_clock_id_clocks_id_fk" FOREIGN KEY ("clock_id") REFERENCES "public"."clocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_members" ADD CONSTRAINT "station_members_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_members" ADD CONSTRAINT "station_members_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_tracks" ADD CONSTRAINT "voice_tracks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_tracks" ADD CONSTRAINT "voice_tracks_recorded_by_auth_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_tracks" ADD CONSTRAINT "voice_tracks_target_clock_slot_id_clock_slots_id_fk" FOREIGN KEY ("target_clock_slot_id") REFERENCES "public"."clock_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_usage_org_at" ON "ai_usage" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_station_at" ON "ai_usage" USING btree ("station_id","at");--> statement-breakpoint
CREATE INDEX "idx_audit_station_at" ON "audit_log" USING btree ("station_id","at");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_categories_station" ON "categories" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "idx_clock_slots_clock" ON "clock_slots" USING btree ("clock_id");--> statement-breakpoint
CREATE INDEX "idx_clock_slots_category" ON "clock_slots" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_clocks_station" ON "clocks" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "idx_comments_target" ON "comments" USING btree ("station_id","target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_comments_author" ON "comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "idx_play_log_station_played_at" ON "play_log" USING btree ("station_id","played_at");--> statement-breakpoint
CREATE INDEX "idx_play_log_track" ON "play_log" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "idx_playlist_tracks_pl" ON "playlist_tracks" USING btree ("playlist_id");--> statement-breakpoint
CREATE INDEX "idx_presence_target" ON "presence_sessions" USING btree ("station_id","target_type","target_id","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "idx_radio_tracks_station" ON "radio_tracks" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "idx_radio_tracks_category" ON "radio_tracks" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_radio_tracks_content_hash" ON "radio_tracks" USING btree ("station_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_schedule_station_weekday_hour" ON "schedule_assignments" USING btree ("station_id","weekday","hour");--> statement-breakpoint
CREATE INDEX "idx_schedule_clock" ON "schedule_assignments" USING btree ("clock_id");--> statement-breakpoint
CREATE INDEX "idx_station_members_user" ON "station_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stations_org" ON "stations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_tracks_album" ON "tracks" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "idx_tracks_artist" ON "tracks" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "idx_voice_tracks_station" ON "voice_tracks" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "idx_voice_tracks_recorded_by" ON "voice_tracks" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "idx_voice_tracks_target_slot" ON "voice_tracks" USING btree ("target_clock_slot_id");