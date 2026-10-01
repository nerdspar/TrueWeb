import type { Actions, PageServerLoad } from "./$types";
import { HOME_COOKIE, parseHome } from "$lib/home";

export const load: PageServerLoad = ({ cookies }) => ({
  home: parseHome(cookies.get(HOME_COOKIE)),
});

export const actions: Actions = {
  home: async ({ cookies, request, url }) => {
    const form = await request.formData();
    // Validated on the way in as well as the way out: the cookie this writes
    // becomes a redirect target on every launch.
    const home = parseHome(String(form.get("home") ?? ""));
    cookies.set(HOME_COOKIE, home, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      // TrueWeb is usually reached over plain HTTP on the LAN, where a Secure
      // cookie is silently dropped — which would look like the setting not
      // saving. Set it only when the request actually arrived over TLS.
      secure: url.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { home };
  },
};
