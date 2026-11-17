/** Only explicit web destinations are eligible for the remote browser surface. */
export function parseWebDestination(input: string): string {
  const url = new URL(input);
  if (url.username || url.password)
    throw new Error("Credentials must not be embedded in URLs");
  if (url.protocol === "https:") return url.href;
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return url.href;
  throw new Error("Use HTTPS, or HTTP for a local development page");
}
