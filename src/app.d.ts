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

export {};
