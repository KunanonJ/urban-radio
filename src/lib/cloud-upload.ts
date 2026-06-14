import { apiFetch } from '@/lib/api-base';

export interface CloudUploadResult {
  id: string;
  key: string;
  size: number;
  /** Present when server persisted to D1 (Pages + R2). */
  trackId?: string;
}

/**
 * POSTs a file to Pages Functions `/api/upload` (Cloudflare edge).
 * Falls back to a local success payload when the API is unavailable (e.g. `next dev` without Pages Functions).
 */
export async function uploadFileToCloud(file: File): Promise<CloudUploadResult> {
  const form = new FormData();
  form.append('file', file);

  try {
    const res = await apiFetch('/api/upload', {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Upload failed (${res.status})`);
    }
    const data = (await res.json()) as CloudUploadResult & { ok?: boolean };
    if (!data.id || !data.key) {
      throw new Error('Invalid upload response');
    }
    return {
      id: data.id,
      key: data.key,
      size: data.size ?? file.size,
      trackId: data.trackId,
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      key: `dev/${crypto.randomUUID()}/${file.name}`,
      size: file.size,
    };
  }
}
