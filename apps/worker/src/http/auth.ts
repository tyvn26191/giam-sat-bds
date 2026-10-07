// Who is calling: the web app (Firebase ID token) or Cloud Scheduler (Google-signed OIDC token
// for this service's audience, from the dedicated scheduler service account).

import type { Auth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import type { Role } from '@gsb/shared';

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  role: Role | null;
  claims: Record<string, unknown>;
}

export function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m ? m[1]!.trim() : null;
}

export async function verifyUser(auth: Auth, header: string | undefined): Promise<AuthUser | null> {
  const token = bearer(header);
  if (!token) return null;
  try {
    const d = await auth.verifyIdToken(token);
    const role = d.role === 'admin' || d.role === 'member' ? (d.role as Role) : null;
    return { uid: d.uid, email: d.email ?? null, emailVerified: d.email_verified === true, role, claims: d };
  } catch {
    return null;
  }
}

export interface TaskAuthConfig {
  mode: 'oidc' | 'none';
  audience: string | null;
  serviceAccount: string | null;
}

export class TaskAuth {
  private readonly client = new OAuth2Client();
  constructor(private readonly cfg: TaskAuthConfig) {}

  async verify(header: string | undefined): Promise<boolean> {
    if (this.cfg.mode === 'none') return true; // local development only (refused on Cloud Run)
    const token = bearer(header);
    if (!token || !this.cfg.audience || !this.cfg.serviceAccount) return false;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.cfg.audience });
      const p = ticket.getPayload();
      return !!p && p.email_verified === true && p.email?.toLowerCase() === this.cfg.serviceAccount;
    } catch {
      return false;
    }
  }
}
