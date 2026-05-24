// src/services/dashboardService.ts

import { ApiClient, ApiError } from './apiClient';

interface DashboardCreateRequest {
  name: string;
  description?: string;
  layout?: any;
  settings?: any;
  is_public?: boolean;
}

interface DashboardUpdateRequest {
  name?: string;
  description?: string;
  layout?: any;
  settings?: any;
  is_public?: boolean;
}

interface DashboardCardCreateRequest {
  chart_id: number;
  card_row: number;
  card_col: number;
  size_x: number;
  size_y: number;
  visualization_settings?: any;
  parameter_mappings?: any;
}

interface DashboardCardUpdateRequest {
  card_row?: number;
  card_col?: number;
  size_x?: number;
  size_y?: number;
  visualization_settings?: any;
  parameter_mappings?: any;
}

export class DashboardService {
  static async getUserDashboards(): Promise<any[]> {
    try {
      return await ApiClient.get<any[]>('/dashboards/');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取仪表盘列表失败');
      }
      throw new Error('获取仪表盘列表失败');
    }
  }

  static async createDashboard(dashboardData: DashboardCreateRequest): Promise<any> {
    try {
      return await ApiClient.post<any>('/dashboards/', dashboardData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建仪表盘失败');
      }
      throw new Error('创建仪表盘失败');
    }
  }

  static async getDashboard(dashboardId: number): Promise<any> {
    try {
      return await ApiClient.get<any>(`/dashboards/${dashboardId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取仪表盘失败');
      }
      throw new Error('获取仪表盘失败');
    }
  }

  static async updateDashboard(dashboardId: number, dashboardData: DashboardUpdateRequest): Promise<any> {
    try {
      return await ApiClient.put<any>(`/dashboards/${dashboardId}`, dashboardData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新仪表盘失败');
      }
      throw new Error('更新仪表盘失败');
    }
  }

  static async addChartToDashboard(dashboardId: number, cardData: DashboardCardCreateRequest): Promise<any> {
    try {
      return await ApiClient.post<any>(`/dashboards/${dashboardId}/cards`, cardData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '添加图表到仪表盘失败');
      }
      throw new Error('添加图表到仪表盘失败');
    }
  }

  static async updateDashboardCard(cardId: number, updateData: DashboardCardUpdateRequest): Promise<any> {
    try {
      return await ApiClient.put<any>(`/dashboards/cards/${cardId}`, updateData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新仪表盘卡片失败');
      }
      throw new Error('更新仪表盘卡片失败');
    }
  }

  static async removeChartFromDashboard(cardId: number): Promise<void> {
    try {
      await ApiClient.delete(`/dashboards/cards/${cardId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '从仪表盘移除图表失败');
      }
      throw new Error('从仪表盘移除图表失败');
    }
  }

  static async deleteDashboard(dashboardId: number): Promise<void> {
    try {
      await ApiClient.delete(`/dashboards/${dashboardId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '删除仪表盘失败');
      }
      throw new Error('删除仪表盘失败');
    }
  }

  // ============ 筛选器相关方法 ============

  static async getDashboardFilters(dashboardId: number): Promise<any[]> {
    try {
      return await ApiClient.get<any[]>(`/dashboards/${dashboardId}/filters`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取筛选器列表失败');
      }
      throw new Error('获取筛选器列表失败');
    }
  }

  static async createFilter(dashboardId: number, filterData: any): Promise<any> {
    try {
      return await ApiClient.post<any>(`/dashboards/${dashboardId}/filters`, filterData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建筛选器失败');
      }
      throw new Error('创建筛选器失败');
    }
  }

  static async updateFilter(filterId: number, filterData: any): Promise<any> {
    try {
      return await ApiClient.put<any>(`/dashboards/filters/${filterId}`, filterData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新筛选器失败');
      }
      throw new Error('更新筛选器失败');
    }
  }

  static async deleteFilter(filterId: number): Promise<void> {
    try {
      await ApiClient.delete(`/dashboards/filters/${filterId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '删除筛选器失败');
      }
      throw new Error('删除筛选器失败');
    }
  }

  static async bindFilterToCard(filterId: number, bindingData: any): Promise<any> {
    try {
      return await ApiClient.post<any>(`/dashboards/filters/${filterId}/bindings`, bindingData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '绑定筛选器失败');
      }
      throw new Error('绑定筛选器失败');
    }
  }

  static async unbindFilterFromCard(filterId: number, cardId: number): Promise<void> {
    try {
      await ApiClient.delete(`/dashboards/filters/${filterId}/bindings/${cardId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '解除筛选器绑定失败');
      }
      throw new Error('解除筛选器绑定失败');
    }
  }
}
