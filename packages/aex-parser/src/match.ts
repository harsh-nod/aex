/**
 * Shared wildcard pattern matching for AEX tool permissions.
 *
 * Supported patterns:
 *   "*"           matches everything
 *   "network.*"   matches "network.fetch", "network.post", etc.
 *                 does NOT match "networkx.foo" (dot boundary is enforced)
 *   "file.read"   matches only "file.read" (exact match)
 */
export function matchPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return name.startsWith(prefix) || name === pattern.slice(0, -2);
  }
  return name === pattern;
}

export function matchesAny(name: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (matchPattern(name, pattern)) return true;
  }
  return false;
}
