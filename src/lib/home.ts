/**
 * Which tab the app opens on (§5 settings).
 *
 * The manifest's `start_url` is `/`, so `/` is not a page — it is the launcher,
 * and its only job is to send you to your chosen tab. That is why the dashboard
 * lives at `/dashboard` rather than at `/`: if the Dashboard tab pointed at `/`
 * and `/` redirected, tapping Dashboard would bounce you to whatever your
 * default is, and the tab would be unreachable.
 *
 * The preference is a cookie rather than localStorage so the server can do the
 * redirect itself. Read from localStorage it would have to happen after
 * hydration, which means every launch flashes the dashboard before jumping —
 * exactly the annoyance the setting exists to remove.
 */
export const HOME_COOKIE = "trueweb_home";

export const HOME_TABS = [
  { value: "dashboard", label: "Dashboard", path: "/dashboard" },
  { value: "storage", label: "Storage", path: "/storage" },
  { value: "datasets", label: "Datasets", path: "/datasets" },
  { value: "apps", label: "Apps", path: "/apps" },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]["value"];

/** What a fresh install opens on, and the fallback for anything unrecognised. */
export const DEFAULT_HOME: HomeTab = "dashboard";

/**
 * Coerce a stored value to a known tab.
 *
 * This guards a redirect target that comes from a cookie — something the client
 * fully controls. Anything not on the list becomes the default, so a hand-edited
 * cookie can send you to another tab at worst, never to another site.
 */
export function parseHome(value: string | undefined | null): HomeTab {
  return HOME_TABS.some((t) => t.value === value)
    ? (value as HomeTab)
    : DEFAULT_HOME;
}

/** The path to open for a stored value, validated on the way through. */
export function homePath(value: string | undefined | null): string {
  const tab = parseHome(value);
  return HOME_TABS.find((t) => t.value === tab)!.path;
}

/** The label to show for the current setting. */
export function homeLabel(value: string | undefined | null): string {
  const tab = parseHome(value);
  return HOME_TABS.find((t) => t.value === tab)!.label;
}
