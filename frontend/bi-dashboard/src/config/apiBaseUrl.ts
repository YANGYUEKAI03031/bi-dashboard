/**
 * API 根地址：
 * - 用局域网 IP 打开前端时，必须请求「当前页面的主机:8000」，不能用 .env 里的 127.0.0.1，
 *   否则其他电脑会把请求打到自己本机，出现 ERR_CONNECTION_REFUSED。
 * - 仅在 localhost / 127.0.0.1 打开时，才使用 REACT_APP_API_BASE_URL 或默认本机后端。
 */
const DEFAULT_LOCAL = 'http://127.0.0.1:8000/api/v1';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.REACT_APP_API_BASE_URL || DEFAULT_LOCAL;
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  if (!isLoopbackHost(hostname)) {
    return `${protocol}//${hostname}:8000/api/v1`;
  }

  return process.env.REACT_APP_API_BASE_URL || DEFAULT_LOCAL;
}

/** 模块加载时算一次即可（与页面访问主机一致） */
export const API_BASE_URL = getApiBaseUrl();
