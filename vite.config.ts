import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// MeetFlow is a pure static site. There is no server, no env var and no database:
// scheduling, the meeting room, notes and action items all run in the browser and persist
// to localStorage. adapter-static + prerender means `build/` can be dropped on GitHub
// Pages, Vercel or Netlify unchanged.
//
// The SPA fallback is `200.html`, NOT `index.html`: naming it index.html makes the adapter
// overwrite the prerendered landing page with a bare JS-only shell, costing the real
// <h1>/description in the served markup. Hosts rewrite unmatched paths to 200.html
// (see vercel.json). `index.html` still exists at the build root - a requirement from the
// brief - because `/` is prerendered.
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({ fallback: '200.html', strict: false })
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node'
	}
});
