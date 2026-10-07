import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse, Role } from '@gsb/shared';
import { api } from './api';
import { auth } from './firebase';

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User; role: Role | null; me: MeResponse | null; apiError: string | null };

interface AuthApi {
  session: Session;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signInGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

async function resolveSession(user: User): Promise<Session> {
  let me: MeResponse | null = null;
  let apiError: string | null = null;
  try {
    me = await api<MeResponse>('/api/me');
    if (me.claimsUpdated) await user.getIdToken(true);
  } catch (e) {
    apiError = (e as Error).message;
  }
  const token = await user.getIdTokenResult();
  const claim = token.claims.role;
  const role: Role | null = claim === 'admin' || claim === 'member' ? claim : (me?.role ?? null);
  return { status: 'signedIn', user, role, me, apiError };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          setSession({ status: 'signedOut' });
          return;
        }
        void resolveSession(user).then(setSession);
      }),
    [],
  );

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    await user.reload();
    await user.getIdToken(true);
    setSession(await resolveSession(user));
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      session,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      signUp: async (email, password) => {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user).catch(() => undefined);
      },
      signInGoogle: async () => {
        await signInWithPopup(auth, new GoogleAuthProvider());
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email);
      },
      resendVerification: async () => {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
      refresh,
      signOut: async () => {
        await fbSignOut(auth);
      },
    }),
    [session, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The signed-in, approved user (only call under the approved-route guard). */
export function useMe(): { uid: string; email: string | null; role: Role; me: MeResponse | null } {
  const { session } = useAuth();
  if (session.status !== 'signedIn' || !session.role) throw new Error('not approved');
  return { uid: session.user.uid, email: session.user.email, role: session.role, me: session.me };
}
