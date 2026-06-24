// MCP request proxying. Browsers block direct cross-origin fetches to most MCP
// servers (no permissive CORS), so the SDK lets callers route MCP requests
// through a proxy of their choosing.
//
// Forms accepted:
//   - function: (targetUrl) => requestUrl                  full control
//   - string with `{url}`:   'https://cors.example/?u={url}'   (URL-encoded)
//   - string with `{rawUrl}':'https://cors.example/{rawUrl}'   (raw)
//   - bare prefix:           'https://cors.example/'           (raw URL appended)
//
// The proxy must forward the request (method, body, headers — including
// `Mcp-Session-Id` and `Content-Type`) to the target and echo permissive CORS
// headers and the `Mcp-Session-Id` response header back.

export type McpProxy = string | ((targetUrl: string) => string)

/** Resolve the actual request URL for a target MCP endpoint given a proxy. */
export function applyProxy(targetUrl: string, proxy?: McpProxy): string {
  if (!proxy) return targetUrl
  if (typeof proxy === 'function') return proxy(targetUrl)
  if (proxy.includes('{url}')) return proxy.replace('{url}', encodeURIComponent(targetUrl))
  if (proxy.includes('{rawUrl}')) return proxy.replace('{rawUrl}', targetUrl)
  return proxy + targetUrl
}
