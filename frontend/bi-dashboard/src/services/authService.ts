// src/services/authService.ts

// 配置基础URL - 根据你的后端地址调整
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

// 认证响应接口
export interface AuthResponse {
  success: boolean;
  token?: string;
  message?: string;
  user?: {
    id: number;
    username: string;
    email?: string;
    full_name?: string;
  };
}

// 登录凭据接口
export interface LoginCredentials {
  username: string;
  password: string;
}

// 认证服务类
export class AuthService {
  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    console.log('=== 登录请求开始 ===');
    console.log('API_BASE_URL:', API_BASE_URL);
    console.log('Credentials:', credentials);
    
    try {
      // 构建请求配置
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password
        }),
      };
      
      console.log('Request options:', requestOptions);
      console.log('Request URL:', `${API_BASE_URL}/auth/login`);
      console.log('Request body:', requestOptions.body);
      
      // 发送POST请求到后端登录接口
      const response = await fetch(`${API_BASE_URL}/auth/login`, requestOptions);

      console.log('=== 响应信息 ===');
      console.log('Response status:', response.status);
      console.log('Response statusText:', response.statusText);
      console.log('Response headers:', [...response.headers.entries()]);
      console.log('Response URL:', response.url);

      // 检查响应状态
      if (!response.ok) {
        let errorMessage = '登录失败';
        try {
          const errorData = await response.json();
          console.log('Error response data:', errorData);
          errorMessage = errorData.detail || errorData.message || `HTTP ${response.status}: ${response.statusText}`;
        } catch (e) {
          // 如果无法解析JSON，使用状态文本
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        
        return {
          success: false,
          message: errorMessage
        };
      }

      // 解析成功的响应数据
      const data = await response.json();
      console.log('Success response data:', data);
      
      // 如果登录成功，保存token
      if (data.success && data.token) {
        this.setAuthToken(data.token);
        console.log('登录成功，token已保存');
            
        // 登录成功后自动刷新页面，确保dashboard正确加载
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
      
      return data as AuthResponse;
      
    } catch (error: any) {
      console.error('=== 登录请求失败 ===');
      console.error('Error:', error);
      
      // 网络错误处理
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          message: '无法连接到服务器，请检查网络连接或确认后端服务是否运行'
        };
      }
      
      // 其他错误
      return {
        success: false,
        message: '登录过程中发生未知错误'
      };
    }
  }

  // 保存token到localStorage
  static setAuthToken(token: string): void {
    console.log('保存token到localStorage:', token.substring(0, 20) + '...');
    localStorage.setItem('authToken', token);
  }

  // 获取存储的token
  static getAuthToken(): string | null {
    const token = localStorage.getItem('authToken');
    console.log('从localStorage获取token:', token ? token.substring(0, 20) + '...' : 'null');
    return token;
  }

  // 清除认证信息
  static clearAuth(): void {
    console.log('清除认证信息');
    localStorage.removeItem('authToken');
  }

  // 检查是否已认证
  static isAuthenticated(): boolean {
    const token = this.getAuthToken();
    const isAuthenticated = !!token;
    console.log('检查认证状态:', isAuthenticated);
    return isAuthenticated;
  }

  // 获取当前用户信息
  static async getCurrentUser(): Promise<any> {
    const token = this.getAuthToken();
    console.log('getCurrentUser - Token:', token ? '存在' : '不存在');
    
    if (!token) {
      return null;
    }

    try {
      console.log('发送获取用户信息请求到:', `${API_BASE_URL}/auth/me`);
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('用户信息响应状态:', response.status);
      
      if (!response.ok) {
        // 如果token过期或无效，清除认证信息
        if (response.status === 401) {
          console.log('Token无效或过期，清除认证信息');
          this.clearAuth();
        }
        return null;
      }

      const userData = await response.json();
      console.log('获取到的用户信息:', userData);
      return userData;
    } catch (error) {
      console.error('获取用户信息失败:', error);
      return null;
    }
  }

  /** 修改当前用户密码（仅登录后可用） */
  static async changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    const token = this.getAuthToken();
    if (!token) return { success: false, message: '请先登录' };
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me/password`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
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

  // 登出功能
  static async logout(): Promise<void> {
    const token = this.getAuthToken();
    if (token) {
      try {
        // 调用后端登出接口
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        console.error('登出请求失败:', error);
      }
    }
    
    // 清除本地认证信息
    this.clearAuth();
  }
}