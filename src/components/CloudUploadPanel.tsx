import { useCallback, useRef, useState } from 'react';
import { Cloud, Upload, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Track } from '@/lib/types';
import { useCloudLibraryStore, buildCloudTrackFromFile } from '@/lib/cloud-library-store';
import { uploadFileToCloud } from '@/lib/cloud-upload';
import { sha256HexFromFile } from '@/lib/file-hash';

const ACCEPT = 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,.webm';

export function CloudUploadPanel() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const tracks = useCloudLibraryStore((s) => s.tracks);
  const lastUploadAt = useCloudLibraryStore((s) => s.lastUploadAt);
  const addCloudTracks = useCloudLibraryStore((s) => s.addCloudTracks);
  const removeCloudTrack = useCloudLibraryStore((s) => s.removeCloudTrack);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.size > 0);
      if (list.length === 0) return;

      setBusy(true);
      const pending: { track: Track; blobUrl: string }[] = [];
      const skippedEarly: string[] = [];
      const hashSeen = new Set(
        useCloudLibraryStore
          .getState()
          .tracks.map((tr) => tr.contentHash)
          .filter((h): h is string => Boolean(h))
      );

      try {
        for (const file of list) {
          const contentHash = await sha256HexFromFile(file);
          if (hashSeen.has(contentHash)) {
            skippedEarly.push(file.name);
            continue;
          }
          hashSeen.add(contentHash);

          const result = await uploadFileToCloud(file);
          const trackId = result.trackId ?? `cloud-${result.id}`;
          const blobUrl = URL.createObjectURL(file);
          const track = buildCloudTrackFromFile(
            file,
            { id: result.id, key: result.key },
            trackId,
            contentHash
          );
          pending.push({ track, blobUrl });
        }

        const { added, skippedTitles, addedTitles } = addCloudTracks(pending);
        const skippedTotal = skippedEarly.length + skippedTitles.length;
        const skippedLabel = [...skippedEarly, ...skippedTitles];

        if (added === 0 && skippedTotal > 0) {
          toast.message(i18n.t('cloudUpload.toast.alreadyInLibrary'), {
            description:
              skippedTotal === 1
                ? skippedLabel[0]
                : i18n.t('cloudUpload.toast.duplicatesSkipped', { count: skippedTotal }),
          });
        } else if (added > 0) {
          toast.success(
            added === 1
              ? i18n.t('cloudUpload.toast.uploadedOne', { title: addedTitles[0] ?? 'file' })
              : i18n.t('cloudUpload.toast.uploadedMany', { count: added })
          );
          if (skippedTotal > 0) {
            toast.message(
              skippedTotal === 1
                ? i18n.t('cloudUpload.toast.skippedLine', { count: skippedTotal })
                : i18n.t('cloudUpload.toast.skippedLinePlural', { count: skippedTotal }),
              {
                description:
                  skippedLabel.slice(0, 3).join(', ') + (skippedTotal > 3 ? '…' : ''),
              }
            );
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : i18n.t('cloudUpload.toast.uploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [addCloudTracks]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const lastSyncLabel =
    lastUploadAt != null
      ? t('cloudUpload.lastUpload', {
          time: formatDistanceToNow(new Date(lastUploadAt), { addSuffix: true }),
        })
      : t('cloudUpload.noUploadsYet');

  return (
    <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg surface-3 flex items-center justify-center text-xl shrink-0">
            <Cloud className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">{t('cloudUpload.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tracks.length === 0
                ? t('cloudUpload.descEmpty')
                : t('cloudUpload.descWithCount', {
                    count: tracks.length,
                    sync: lastSyncLabel,
                  })}
            </p>
          </div>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={onDrop}
        className="border border-dashed border-border rounded-lg px-4 py-8 flex flex-col items-center justify-center gap-3 text-center bg-background/40 transition-colors hover:border-primary/40"
      >
        <Upload className="w-8 h-8 text-muted-foreground/60" />
        <div>
          <p className="text-sm text-foreground font-medium">{t('cloudUpload.dropTitle')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('cloudUpload.dropSubtitle')}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const f = e.target.files;
            if (f?.length) void processFiles(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? t('cloudUpload.uploading') : t('cloudUpload.chooseFiles')}
        </button>
      </div>

      {tracks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t('cloudUpload.uploadedSection')}
          </p>
          <ul className="max-h-[200px] overflow-y-auto space-y-1 pr-1">
            {tracks.map((tr) => (
              <li
                key={tr.id}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 surface-3 text-xs"
              >
                <span className="truncate text-foreground">{tr.title}</span>
                <button
                  type="button"
                  onClick={() => {
                    removeCloudTrack(tr.id);
                    toast.message(t('cloudUpload.removedToast'));
                  }}
                  className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label={`Remove ${tr.title}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
