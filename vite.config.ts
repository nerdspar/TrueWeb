import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// Reachable from the iPhone on the LAN during dev.
		host: true,
		port: 8110
	}
});
