"use client";

import { useParams } from "next/navigation";

import { SettingsPage } from "@/views/app/SettingsPage";

/**
 * Dynamic settings section route. Reads the [section] URL segment via
 * useParams and hands it to SettingsPage, which validates the id and
 * either renders the matching section or a not-found EmptyState.
 *
 * The base /app/settings page also renders SettingsPage (with no
 * section argument, defaulting to "station").
 */
export default function SettingsSectionPage() {
  const params = useParams();
  const raw = params?.section;
  const section = Array.isArray(raw) ? raw[0] : raw;
  return <SettingsPage section={typeof section === "string" ? section : undefined} />;
}
