// Derive candidate URLs from explicit Ingress hosts and paths, not LB IPs.
export function ingressUrls(obj: any): string[] {
  const tlsHosts = (obj.spec?.tls || []).flatMap((entry: any) => entry.hosts || []) as string[]
  const urls = new Set<string>()
  for (const rule of obj.spec?.rules || []) {
    const host = rule.host
    // Wildcards and catch-all hosts are not concrete browser destinations.
    if (typeof host !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)) continue
    const secure = tlsHosts.some(h => h === host || (h.startsWith('*.') && host.endsWith(h.slice(1)) && host.split('.').length === h.split('.').length))
    for (const entry of rule.http?.paths || []) {
      const path = entry.path || '/'
      // Regex paths cannot be translated into a concrete URL.
      if (typeof path !== 'string' || !path.startsWith('/') || /[\\\s?#*()[\]{}|^$]/.test(path)) continue
      urls.add((secure ? 'https://' : 'http://') + host + path)
    }
  }
  return [...urls]
}

export function configLanguage(key: string, value: string): string {
  if (/\.ya?ml$/i.test(key)) return 'yaml'
  if (/\.json$/i.test(key)) return 'json'
  if (/\.properties$/i.test(key)) return 'conf'
  if (/\.xml$/i.test(key)) return 'xml'
  const trimmed = value.trim()
  if (/^[{\[]/.test(trimmed)) {
    try { JSON.parse(trimmed); return 'json' } catch { /* not JSON */ }
  }
  if (/^<\?xml\b|^<[a-zA-Z][\w:-]*[\s>]/.test(trimmed)) return 'xml'
  if (/^\s*[\w.-]+\s*=/m.test(value)) return 'conf'
  if (/^\s*[\w.-]+:\s+/m.test(value)) return 'yaml'
  return 'text'
}
