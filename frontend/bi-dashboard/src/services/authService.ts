// src/services/authService.ts
import { API_BASE_URL } from '../config/apiBaseUrl';
import { ApiClient, ApiError } from './apiClient';

export interface AuthResponse {
  success: boolean;
  token?: string;
  message?: string;
  user?: {
    id: number;
    username: string;
    email?: string;
    full_name?: string;
    role?: 'admin' | 'user';
    is_admin?: boolean;
  };
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export class AuthService {
  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const data = await ApiClient.post<AuthResponse>('/auth/login', {
        username: credentials.username,
        password: credentials.password,
      });

      if (data.success && data.token) {
        this.setAuthToken(data.token);
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        return {
          success: false,
          message: error.message,
        };
      }

      return {
        success: false,
        message: '登录过程中发生未知错误',
      };
    }
  }

  static setAuthToken(token: string): void {
    ApiClient.setToken(token);
  }

  static getAuthToken(): string | null {
    return ApiClient.getToken();
  }

  static clearAuth(): void {
    ApiClient.clearToken();
  }

  static isAuthenticated(): boolean {
    return ApiClient.isAuthenticated();
  }

  static async getCurrentUser(): Promise<any> {
    if (!ApiClient.isAuthenticated()) {
      return null;
    }

    try {
      const data = await ApiClient.get('/auth/me');
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        this.clearAuth();
      }
      return null;
    }
  }

  static async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (!ApiClient.isAuthenticated()) {
      return { success: false, message: '请先登录' };
    }

    try {
      await ApiClient.put('/auth/me/password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) {
        return { success: false, message: error.message };
      }
      return { success: false, message: '网络错误' };
    }
  }

  static async logout(): Promise<void> {
    // 先清除本地 token，避免后端不可达时无法退出
    const token = ApiClient.getToken();
    this.clearAuth();

    if (!token) {
      return;
    }

    try {
      // 使用较短超时，避免阻塞退出
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch {
      // 服务端登出失败不影响本地已退出
    }
  }
}
