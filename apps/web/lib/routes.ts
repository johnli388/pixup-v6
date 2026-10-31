// Route shapes handled by the legacy client router. Resource IDs are checked by their APIs.
export function isApplicationRoute(parts: string[]) {
  const path = parts.join('/');
  return (
    /^(|marketplace|login|ops|identity\/action)$/.test(path) ||
    /^(channels|collections)(\/[^/]+)?$/.test(path) ||
    /^(items|checkout|verify)\/[^/]+$/.test(path) ||
    /^account\/(collection|saved|credits|activity|settings|support|security)$/.test(path) ||
    /^account\/orders(\/[^/]+)?$/.test(path) ||
    /^workspace\/(seller|creator|channels|developer)$/.test(path)
  );
}

export function isCommunityRoute(parts: string[]) {
  const path = parts.join('/');
  return (
    /^(|settings|recovery|notifications|new|mine|saved|following)$/.test(path) ||
    /^topics(\/[^/]+)?$/.test(path) ||
    /^posts\/[^/]+(\/edit)?$/.test(path) ||
    /^members\/[^/]+$/.test(path) ||
    /^samples(\/topics(\/[^/]+)?|\/posts\/[^/]+)?$/.test(path)
  );
}
