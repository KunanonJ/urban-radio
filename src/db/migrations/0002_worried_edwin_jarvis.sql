DROP INDEX "idx_radio_tracks_content_hash";--> statement-breakpoint
ALTER TABLE "radio_tracks" ADD CONSTRAINT "uq_radio_tracks_station_content_hash" UNIQUE("station_id","content_hash");