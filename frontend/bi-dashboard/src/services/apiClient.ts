/**
 * 统一 API 客户端
 *
 * 特点：
 * - 统一 token 管理（自动从 localStorage 读取/存储）
 * - 统一错误处理（网络错误、超时、HTTP 错误）
 * - 统一超时处理（默认 30 秒）
 * - 统一请求头配置
 * - 保持与原有 fetch 调用兼容的返回格式
 */
import { API_BASE_URL } from '../config/apiBaseUrl';

const TOKEN_KEY = 'authToken';
const DEFAULT_TIMEOUT = 30000; // 30 秒

export class ApiClient {
  private static timeout = DEFAULT_TIMEOUT;

  /**
   * 设置全局请求超时时间
   */
  static setTimeout(ms: number): void {
    this.timeout = ms;
  }

  /**
   * 获取当前 token
   */
  static getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /**
   * 设置 token
   */
  static setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  /**
   * 清除 token
   */
  static clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  /**
   * 检查是否已认证
   */
  static isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * 统一请求方法
   *
   * @param endpoint API 端点（相对于 /api/v1）
   * @param options fetch 选项
   * @returns 响应数据（不包含 ok/error 等包装）
   */
  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // 401 时清除 token
        if (response.status === 401) {
          this.clearToken();
        }

        // 尝试解析错误信息
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          // 无法解析 JSON，使用默认消息
        }

        throw new ApiError(response.status, errorMessage);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, `请求超时（${this.timeout / 1000}秒）`);
      }

      if (error instanceof TypeError) {
        throw new ApiError(0, '无法连接到服务器，请检查网络连接或确认后端服务是否运行');
      }

      throw new ApiError(0, '请求失败');
    }
  }

  /**
   * GET 请求
   */
  static get<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST 请求
   */
  static post<T = any>(endpoint: string, data?: any, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT 请求
   */
  static put<T = any>(endpoint: string, data?: any, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PATCH 请求
   */
  static patch<T = any>(endpoint: string, data?: any, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE 请求
   */
  static delete<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * 带超时控制的请求（用于需要自定义超时的场景）
   */
  static async requestWithTimeout<T = any>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT,
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          this.clearToken();
        }
        throw new ApiError(response.status, `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, `请求超时（${timeoutMs / 1000}秒）`);
      }
      throw new ApiError(0, '请求失败');
    }
  }
}

/**
 * API 错误类
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}
