import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [sveltekit()],
	define: { __APP_VERSION__: JSON.stringify(loadEnv(mode, '.', 'APP_').APP_VERSION || 'dev') },
	// Components under test are client-side: without the browser condition,
	// Svelte resolves to its server build and mount() is unavailable.
	...(mode === 'test' ? { resolve: { conditions: ['browser'] } } : {}),
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	}
}));
