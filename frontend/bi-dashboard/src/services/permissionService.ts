// src/services/permissionService.ts

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

// 用户角色类型
export type UserRole = 'admin' | 'user';

// 用户信息接口
export interface UserInfo {
  user_id: number;
  accountname: string;
  role: UserRole;
  // 后端/驱动有时会返回 "1"/"0" 字符串，这里做兼容
  state: number | string | null;
}

export interface CreateUserPayload {
  accountname: string;
  password: string;
  state?: number;
  role?: UserRole;
}

// 当前用户权限信息
export interface UserPermissions {
  user_id: number;
  role: UserRole;
  is_admin: boolean;
  visible_report_pages: number[];
}

// 用户角色服务
export class PermissionService {
  private static getToken(): string | null {
    return localStorage.getItem('authToken');
  }

  private static async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getToken();
    if (!token) {
      throw new Error('未登录或token已过期');
    }

    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });
  }

  // 获取当前用户角色
  static async getMyRole(): Promise<UserPermissions> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/permissions/my-role`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取角色失败');
    }
    return response.json();
  }

  // 获取当前用户完整权限信息
  static async getMyPermissions(): Promise<UserPermissions> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/permissions/my-permissions`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取权限失败');
    }
    return response.json();
  }

  // 获取所有用户及其角色（仅管理员可访问）
  static async getAllUsersWithRoles(): Promise<UserInfo[]> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/permissions/users`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取用户列表失败');
    }
    return response.json();
  }

  // 设置用户角色（仅管理员可访问）
  static async setUserRole(userId: number, role: UserRole): Promise<void> {
    const response = await this.fetchWithAuth(
      `${API_BASE_URL}/permissions/users/${userId}/role?role=${role}`,
      { method: 'PUT' }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '设置角色失败');
    }
  }

  // 创建新用户（仅管理员可访问）
  static async createUser(payload: CreateUserPayload): Promise<UserInfo> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/permissions/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '创建用户失败');
    }
    return response.json();
  }

  // ============ 报表权限管理 ============

  // 获取所有报表列表（仅管理员可访问）
  static async getAllReportPages(): Promise<any[]> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/report-pages`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取报表列表失败');
    }
    return response.json();
  }

  // 授权用户查看/编辑报表（仅管理员或报表创建者可访问）
  static async grantReportPagePermission(
    reportPageId: number,
    targetUserId: number,
    canEdit: boolean = false
  ): Promise<{ message: string; can_edit: boolean }> {
    const response = await this.fetchWithAuth(
      `${API_BASE_URL}/permissions/report-pages/${reportPageId}/grant?target_user_id=${targetUserId}&can_edit=${canEdit}`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '授权失败');
    }
    return response.json();
  }

  // 撤销用户报表权限
  static async revokeReportPagePermission(reportPageId: number, targetUserId: number): Promise<void> {
    const response = await this.fetchWithAuth(
      `${API_BASE_URL}/permissions/report-pages/${reportPageId}/revoke/${targetUserId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '撤销权限失败');
    }
  }

  // 获取指定报表的权限列表（谁有权限看/编辑）
  static async getReportPagePermissions(reportPageId: number): Promise<any[]> {
    const response = await this.fetchWithAuth(`${API_BASE_URL}/permissions/report-pages/${reportPageId}/permissions`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取权限列表失败');
    }
    return response.json();
  }
}
