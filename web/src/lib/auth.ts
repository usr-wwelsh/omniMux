import { writable, derived } from 'svelte/store';

interface AuthState {
  authenticated: boolean;
  token: string;
  username: string;
  role: string;
}

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('omnimux_auth') : null;
// Strip any password persisted by an older build — credentials no longer live client-side.
const initial: AuthState = stored
  ? (() => {
      const { password, ...rest } = JSON.parse(stored);
      return { authenticated: false, token: '', username: '', role: 'user', ...rest };
    })()
  : { authenticated: false, token: '', username: '', role: 'user' };

export const auth = writable<AuthState>(initial);

auth.subscribe((value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('omnimux_auth', JSON.stringify(value));
  }
});

export const isGuest = derived(auth, ($auth) => $auth.role === 'guest');

export function login(token: string, username: string, role = 'user') {
  auth.set({ authenticated: true, token, username, role });
}

export function logout() {
  auth.set({ authenticated: false, token: '', username: '', role: 'user' });
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('omnimux_auth');
  }
  // Clear the server-side httpOnly token cookie.
  if (typeof fetch !== 'undefined') {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
}
