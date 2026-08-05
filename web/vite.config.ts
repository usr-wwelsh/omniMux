import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [sveltekit()],
	// Components under test are client-side: without the browser condition,
	// Svelte resolves to its server build and mount() is unavailable.
	...(mode === 'test' ? { resolve: { conditions: ['browser'] } } : {}),
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	}
}));
