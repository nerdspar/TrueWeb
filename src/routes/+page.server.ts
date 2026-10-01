import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { HOME_COOKIE, homePath } from "$lib/home";

/**
 * The launcher. `start_url` is `/`, so this is what the installed PWA opens;
 * it renders nothing and forwards to the tab chosen in Settings.
 *
 * 302, not 301: the target changes whenever the setting changes, and a browser
 * that cached a permanent redirect would pin the app to an old choice with no
 * way back.
 */
export const load: PageServerLoad = ({ cookies }) => {
  redirect(302, homePath(cookies.get(HOME_COOKIE)));
};
