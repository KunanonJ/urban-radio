/**
 * API base URL for catalog/search fetches. Same-origin `/api` by default.
 * Set `NEXT_PUBLIC_API_BASE_URL` when the API is hosted elsewhere.
 */
const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

export const API_BASE_URL = raw ? raw.replace(/\/$/, '') : '';

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${p}` : p;
}

/**
 * GET/POST/etc. with cookies. Pass a path like `/api/catalog` (prepends `NEXT_PUBLIC_API_BASE_URL` when set)
 * or an absolute `http(s)://…` URL.
 */
export async function apiFetch(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : apiUrl(pathOrUrl);
  return fetch(url, { credentials: 'same-origin', ...init });
}
