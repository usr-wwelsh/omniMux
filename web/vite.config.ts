import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { relative, sep } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => {
					const pathSegments = relative(import.meta.dirname, filename).toLowerCase().split(sep);
					return pathSegments.includes('node_modules') ? undefined : true;
				}
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	define: { __APP_VERSION__: JSON.stringify(loadEnv(mode, '.', 'APP_').APP_VERSION || 'dev') },
	// Components under test are client-side: without the browser condition,
	// Svelte resolves to its server build and mount() is unavailable.
	...(mode === 'test' ? { resolve: { conditions: ['browser'] } } : {}),
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	}
}));
