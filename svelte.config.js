import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-node: the build runs as `node build`, matching the Dockerfile
		// and the Seek deploy pattern.
		adapter: adapter()
	}
};
