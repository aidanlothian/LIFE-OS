// Link helpers shared by the Deep Memory modules that hold web links.

// Only ever http(s). A bare "example.com" gets https:// added; anything
// with another scheme (javascript:, data:, file:, …) is rejected outright
// rather than becoming a clickable link.
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasHttp = /^https?:\/\//i.test(trimmed);
  if (!hasHttp && /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(hasHttp ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isSafeHref(url: string) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
