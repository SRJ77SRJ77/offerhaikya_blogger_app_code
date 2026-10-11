/**
 * Offline-only compatibility layer for the browse-only APK.
 *
 * This module intentionally does not import Firebase or make network requests.
 * Account/profile/cloud writes are disabled. Offer feeds continue to load from Blogger.
 */
type LocalUser = {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  displayName: string | null;
};

const listeners = new Set<(user: LocalUser | null) => void>();
const makeGuest = (): LocalUser => ({
  uid: 'offerhaikya-local-guest',
  isAnonymous: true,
  email: null,
  displayName: null,
});

export const auth: {
  currentUser: LocalUser | null;
  authStateReady: () => Promise<void>;
} = {
  currentUser: makeGuest(),
  authStateReady: async () => undefined,
};

// Compatibility placeholder only; never connects to a Firebase project.
export const db = Object.freeze({ offlineOnly: true });

const unsupported = async (..._args: any[]): Promise<never> => {
  throw new Error('Account services are disabled in this browse-only build.');
};

export const EmailAuthProvider = {
  credential: (email: string, password: string) => ({ providerId: 'password', email, password }),
};

export const createUserWithEmailAndPassword = unsupported;
export const reauthenticateWithCredential = unsupported;
export const linkWithCredential = unsupported;
export const sendPasswordResetEmail = unsupported;
export const signInWithEmailAndPassword = unsupported;
export const updateEmail = unsupported;

export const signInAnonymously = async (_auth?: unknown): Promise<{ user: LocalUser }> => {
  const guest = makeGuest();
  auth.currentUser = guest;
  listeners.forEach(listener => listener(guest));
  return { user: guest };
};

export const signOut = async (_auth?: unknown) => {
  auth.currentUser = null;
  listeners.forEach(listener => listener(null));
};

export const deleteUser = async (_user?: unknown) => {
  auth.currentUser = null;
  listeners.forEach(listener => listener(null));
};

export const updateProfile = async (user: any, profile: { displayName?: string | null }) => {
  if (user && typeof profile?.displayName === 'string') user.displayName = profile.displayName;
};

export const onAuthStateChanged = (
  _auth: unknown,
  callback: (user: LocalUser | null) => void,
) => {
  listeners.add(callback);
  Promise.resolve().then(() => callback(auth.currentUser));
  return () => listeners.delete(callback);
};

export class Timestamp {
  private readonly milliseconds: number;
  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }
  static now() {
    return new Timestamp(Date.now());
  }
  static fromDate(date: Date) {
    return new Timestamp(date.getTime());
  }
  static fromMillis(milliseconds: number) {
    return new Timestamp(milliseconds);
  }
  toMillis() {
    return this.milliseconds;
  }
  toDate() {
    return new Date(this.milliseconds);
  }
}

const makeRef = (kind: string, ...parts: any[]) => ({
  kind,
  path: parts.filter(part => part !== undefined && part !== null).join('/'),
  id: String(parts[parts.length - 1] ?? ''),
});

export const doc = (...parts: any[]) => makeRef('document', ...parts);
export const collection = (...parts: any[]) => makeRef('collection', ...parts);
export const query = (...parts: any[]) => ({ kind: 'query', parts });
export const where = (...parts: any[]) => ({ kind: 'where', parts });
export const arrayUnion = (...values: any[]) => ({ kind: 'arrayUnion', values });
export const arrayRemove = (...values: any[]) => ({ kind: 'arrayRemove', values });
export const serverTimestamp = () => new Timestamp(Date.now());

export const getDoc = async (_ref: unknown) => ({
  exists: () => false,
  data: () => undefined,
  id: '',
});

export const getDocs = async (_ref: unknown) => ({
  docs: [] as any[],
  empty: true,
  size: 0,
  forEach: (_callback: (snapshot: any) => void) => undefined,
});

export const setDoc = async (_ref: unknown, _data: unknown, _options?: unknown) => undefined;
export const deleteDoc = async (_ref: unknown) => undefined;

export const writeBatch = (_db: unknown) => ({
  set: (_ref: unknown, _data: unknown, _options?: unknown) => undefined,
  update: (_ref: unknown, _data: unknown) => undefined,
  delete: (_ref: unknown) => undefined,
  commit: async () => undefined,
});
