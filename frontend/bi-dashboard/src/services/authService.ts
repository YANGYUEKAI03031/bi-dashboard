// src/services/authService.ts
import { API_BASE_URL } from '../config/apiBaseUrl';

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
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
      });

      if (!response.ok) {
        let errorMessage = '登录失败';
        try {
          const errorData = await response.json();
          errorMessage =
            errorData.detail ||
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }

        return {
          success: false,
          message: errorMessage,
        };
      }

      const data = await response.json();

      if (data.success && data.token) {
        this.setAuthToken(data.token);
      }

      return data as AuthResponse;
    } catch (error: unknown) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          message: '无法连接到服务器，请检查网络连接或确认后端服务是否运行',
        };
      }

      return {
        success: false,
        message: '登录过程中发生未知错误',
      };
    }
  }

  static setAuthToken(token: string): void {
    localStorage.setItem('authToken', token);
  }

  static getAuthToken(): string | null {
    return localStorage.getItem('authToken');
  }

  static clearAuth(): void {
    localStorage.removeItem('authToken');
  }

  static isAuthenticated(): boolean {
    return !!this.getAuthToken();
  }

  static async getCurrentUser(): Promise<any> {
    const token = this.getAuthToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.clearAuth();
        }
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  static async changePassword(
    oldPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message?: string }> {
    const token = this.getAuthToken();
    if (!token) return { success: false, message: '请先登录' };
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me/password`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return { success: false, message: (data as any).detail || '修改失败' };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e?.message || '网络错误' };
    }
  }

  static async logout(): Promise<void> {
    const token = this.getAuthToken();
    // 先清除本地 token，避免后端不可达时无法退出
    this.clearAuth();

    if (!token) {
      return;
    }

    try {
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
