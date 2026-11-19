// Where Google sends you back after you approve Calendar/Gmail access.
// On the live Vercel site this is always the site's own production address
// (VERCEL_PROJECT_PRODUCTION_URL, a Vercel system env var). The
// GOOGLE_*_REDIRECT_URI values were copied over from .env.local as
// localhost addresses, which sent Google back to localhost:3000 and
// failed with redirect_uri_mismatch. Locally the env vars still apply.
// Every address used here must also be listed under "Authorized redirect
// URIs" on the "Life OS Platform" OAuth client in Google Cloud.
export function oauthRedirectUri(envName: string, path: string): string {
  const productionHost =
    process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
  if (productionHost) return `https://${productionHost}${path}`;

  const value = process.env[envName];
  if (!value) throw new Error(`Missing required env var: ${envName}`);
  return value;
}
