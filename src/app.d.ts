// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** Whether the request carried a valid session (§7 passcode gate). When
			 *  the gate is disabled (no passcode configured — the LAN default) this
			 *  is always true. */
			authed: boolean;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module 'svelte/elements' {
	interface HTMLAttributes<T> {
		/**
		 * Non-standard WebKit attribute, absent from Svelte's element typings.
		 * §5.2 requires it off: iOS autocorrect otherwise silently mangles image
		 * tags and environment values in a pasted compose file.
		 */
		autocorrect?: 'on' | 'off';
	}
}

export {};
