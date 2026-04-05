'use client';

import { useState, useRef } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { getClientStorage } from '@/lib/firebase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { spotFormSchema, type SpotFormValues } from '@/lib/validators/spot.schema';

interface SpotUploadDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly campaignId: string;
  readonly onSubmit: (values: SpotFormValues & { audioStoragePath: string; contentHash: string }) => void;
  readonly loading?: boolean;
}

export function SpotUploadDialog({
  open,
  onOpenChange,
  campaignId,
  onSubmit,
  loading = false,
}: SpotUploadDialogProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<{ path: string; hash: string; duration: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<SpotFormValues>({
    resolver: zodResolver(spotFormSchema) as Resolver<SpotFormValues>,
    defaultValues: {
      title: '',
      durationSec: 30,
      approvalStatus: 'pending',
      versionLabel: '',
      scriptText: '',
    },
  });

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File size exceeds 20MB limit');
      return;
    }

    setUploadError(null);
    setUploading(true);
    setProgress(0);

    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const audio = new Audio();
      const durationPromise = new Promise<number>((resolve, reject) => {
        audio.addEventListener('loadedmetadata', () => {
          resolve(Math.round(audio.duration));
          URL.revokeObjectURL(audio.src);
        });
        audio.addEventListener('error', () => {
          reject(new Error('Cannot read audio'));
          URL.revokeObjectURL(audio.src);
        });
        audio.src = URL.createObjectURL(file);
      });
      const duration = await durationPromise;

      const storage = getClientStorage();
      const storagePath = `ads/${campaignId}/${hash}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => setProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
        (err) => { setUploadError(err.message); setUploading(false); },
        () => {
          setUploading(false);
          setUploadResult({ path: storagePath, hash, duration });
          form.setValue('durationSec', duration);
        },
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  function handleSubmit(values: SpotFormValues) {
    if (!uploadResult) return;
    onSubmit({
      ...values,
      audioStoragePath: uploadResult.path,
      contentHash: uploadResult.hash,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Spot</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {!uploadResult && (
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center hover:border-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select ad audio (max 20MB)</p>
              <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} disabled={uploading} />
            </div>
          )}

          {uploading && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-center text-xs text-muted-foreground">Uploading... {progress}%</p>
            </div>
          )}

          {uploadResult && (
            <p className="text-sm text-emerald-500">Audio uploaded ({uploadResult.duration}s)</p>
          )}

          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

          <div className="space-y-2">
            <Label>Title</Label>
            <Input placeholder="Summer Sale - 30s" {...form.register('title')} />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Duration (sec)</Label>
              <Input type="number" {...form.register('durationSec')} />
            </div>
            <div className="space-y-2">
              <Label>Version Label</Label>
              <Input placeholder="v1" {...form.register('versionLabel')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Script</Label>
            <Textarea placeholder="Spot script text..." {...form.register('scriptText')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading || uploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || uploading || !uploadResult}>
              {loading ? 'Saving...' : 'Create Spot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
