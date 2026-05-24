// src/services/permissionService.ts

import { ApiClient, ApiError } from './apiClient';

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
  // 获取当前用户角色
  static async getMyRole(): Promise<UserPermissions> {
    try {
      return await ApiClient.get<UserPermissions>('/permissions/my-role');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取角色失败');
      }
      throw new Error('获取角色失败');
    }
  }

  // 获取当前用户完整权限信息
  static async getMyPermissions(): Promise<UserPermissions> {
    try {
      return await ApiClient.get<UserPermissions>('/permissions/my-permissions');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取权限失败');
      }
      throw new Error('获取权限失败');
    }
  }

  // 获取所有用户及其角色（仅管理员可访问）
  static async getAllUsersWithRoles(): Promise<UserInfo[]> {
    try {
      return await ApiClient.get<UserInfo[]>('/permissions/users');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取用户列表失败');
      }
      throw new Error('获取用户列表失败');
    }
  }

  // 设置用户角色（仅管理员可访问）
  static async setUserRole(userId: number, role: UserRole): Promise<void> {
    try {
      await ApiClient.put(`/permissions/users/${userId}/role?role=${role}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '设置角色失败');
      }
      throw new Error('设置角色失败');
    }
  }

  // 创建新用户（仅管理员可访问）
  static async createUser(payload: CreateUserPayload): Promise<UserInfo> {
    try {
      return await ApiClient.post<UserInfo>('/permissions/users', payload);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建用户失败');
      }
      throw new Error('创建用户失败');
    }
  }

  // ============ 报表权限管理 ============

  // 获取所有报表列表（仅管理员可访问）
  static async getAllReportPages(): Promise<any[]> {
    try {
      return await ApiClient.get<any[]>('/report-pages');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取报表列表失败');
      }
      throw new Error('获取报表列表失败');
    }
  }

  // 授权用户查看/编辑报表（仅管理员或报表创建者可访问）
  static async grantReportPagePermission(
    reportPageId: number,
    targetUserId: number,
    canEdit: boolean = false
  ): Promise<{ message: string; can_edit: boolean }> {
    try {
      return await ApiClient.post<{ message: string; can_edit: boolean }>(
        `/permissions/report-pages/${reportPageId}/grant?target_user_id=${targetUserId}&can_edit=${canEdit}`
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '授权失败');
      }
      throw new Error('授权失败');
    }
  }

  // 撤销用户报表权限
  static async revokeReportPagePermission(reportPageId: number, targetUserId: number): Promise<void> {
    try {
      await ApiClient.delete(`/permissions/report-pages/${reportPageId}/revoke/${targetUserId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '撤销权限失败');
      }
      throw new Error('撤销权限失败');
    }
  }

  // 获取指定报表的权限列表（谁有权限看/编辑）
  static async getReportPagePermissions(reportPageId: number): Promise<any[]> {
    try {
      return await ApiClient.get<any[]>(`/permissions/report-pages/${reportPageId}/permissions`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取权限列表失败');
      }
      throw new Error('获取权限列表失败');
    }
  }
}
