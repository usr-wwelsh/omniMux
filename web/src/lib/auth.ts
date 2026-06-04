import { writable, derived } from 'svelte/store';

interface AuthState {
  authenticated: boolean;
  token: string;
  username: string;
  password: string;
  role: string;
}

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('omnimux_auth') : null;
const initial: AuthState = stored
  ? { role: 'user', ...JSON.parse(stored) }
  : { authenticated: false, token: '', username: '', password: '', role: 'user' };

export const auth = writable<AuthState>(initial);

auth.subscribe((value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('omnimux_auth', JSON.stringify(value));
  }
});

export const isGuest = derived(auth, ($auth) => $auth.role === 'guest');

export function login(token: string, username: string, password: string, role = 'user') {
  auth.set({ authenticated: true, token, username, password, role });
}

export function logout() {
  auth.set({ authenticated: false, token: '', username: '', password: '', role: 'user' });
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('omnimux_auth');
  }
}
