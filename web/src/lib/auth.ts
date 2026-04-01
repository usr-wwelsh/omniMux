import { writable } from 'svelte/store';

interface AuthState {
  authenticated: boolean;
  token: string;
  username: string;
  password: string;
}

const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('omnimux_auth') : null;
const initial: AuthState = stored
  ? JSON.parse(stored)
  : { authenticated: false, token: '', username: '', password: '' };

export const auth = writable<AuthState>(initial);

auth.subscribe((value) => {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('omnimux_auth', JSON.stringify(value));
  }
});

export function login(token: string, username: string, password: string) {
  auth.set({ authenticated: true, token, username, password });
}

export function logout() {
  auth.set({ authenticated: false, token: '', username: '', password: '' });
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('omnimux_auth');
  }
}
