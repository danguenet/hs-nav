export function isHubSpotHostname(value) {
  const hostname = String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\.$/, "");
  return hostname === "hubspot.com" || hostname.endsWith(".hubspot.com");
}

export function isHubSpotUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.protocol === "https:" &&
      isHubSpotHostname(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port;
  } catch {
    return false;
  }
}

export function isHubSpotAppHostname(value) {
  const hostname = String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\.$/, "");
  return hostname === "app.hubspot.com" || /^app-[a-z\d-]+\.hubspot\.com$/.test(hostname);
}
