import { V1_PREFIX } from '@branchout/protocol';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Server-side control-plane origin (not exposed to the browser). The browser reaches control-plane
// same-origin via the /api rewrite; server components call it directly here.
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';
const ADMIN_COOKIE = process.env.ADMIN_SESSION_COOKIE_NAME ?? 'branchout_admin_session';

export interface Admin {
  id: string;
  email: string;
  createdBy: string | null;
  createdAt: string;
}

/** The current admin from the host-only admin cookie, or null. Fails closed (null) on any error. */
export async function getAdmin(): Promise<Admin | null> {
  try {
    const store = await cookies();
    const id = store.get(ADMIN_COOKIE)?.value;
    if (!id) return null;
    const res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/admin/auth/me`, {
      headers: { cookie: `${ADMIN_COOKIE}=${encodeURIComponent(id)}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { admin?: Admin | null };
    return data.admin ?? null;
  } catch {
    return null;
  }
}

/** Require an admin session or redirect to the login. The authoritative gate for authed pages. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect('/login');
  return admin;
}

/** Server-side fetch of a control-plane admin endpoint, forwarding the admin cookie. */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const store = await cookies();
  const id = store.get(ADMIN_COOKIE)?.value ?? '';
  return fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: `${ADMIN_COOKIE}=${encodeURIComponent(id)}` },
    cache: 'no-store',
  });
}
