'use client';

import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { getClientStorage } from '@/lib/firebase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface TrackUploadDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUploadComplete: (storagePath: string, contentHash: string, durationSec: number) => void;
}

export function TrackUploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: TrackUploadDialogProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function computeHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.addEventListener('loadedmetadata', () => {
        resolve(Math.round(audio.duration));
        URL.revokeObjectURL(audio.src);
      });
      audio.addEventListener('error', () => {
        reject(new Error('Could not read audio file'));
        URL.revokeObjectURL(audio.src);
      });
      audio.src = URL.createObjectURL(file);
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      setError('File size exceeds 50MB limit');
      return;
    }

    if (!file.type.startsWith('audio/')) {
      setError('Please select an audio file');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      const [contentHash, durationSec] = await Promise.all([
        computeHash(file),
        getAudioDuration(file),
      ]);

      const storage = getClientStorage();
      const storagePath = `tracks/${contentHash}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          setProgress(pct);
        },
        (uploadError) => {
          setError(uploadError.message);
          setUploading(false);
        },
        () => {
          setUploading(false);
          onUploadComplete(storagePath, contentHash, durationSec);
          onOpenChange(false);
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Track</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center hover:border-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Click to select an audio file (MP3, WAV, FLAC)
            </p>
            <p className="text-xs text-muted-foreground">Max 50MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
            />
          </div>

          {uploading && (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Uploading... {progress}%
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
