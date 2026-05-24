// src/services/reportPageService.ts

import { ApiClient, ApiError } from './apiClient';

interface ReportPageCreateRequest {
  name: string;
  description?: string;
  icon?: string;
  order_index?: number;
}

interface ReportPageUpdateRequest {
  name?: string;
  description?: string;
  icon?: string;
  order_index?: number;
  is_active?: boolean;
}

interface ReportPageDashboardCreateRequest {
  dashboard_id: number;
  order_index?: number;
}

interface ReportPageDashboardUpdateRequest {
  order_index: number;
}

export interface ReportPage {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  order_index: number;
  creator_id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  dashboards: ReportPageDashboard[];
}

export interface ReportPageDashboard {
  id: number;
  report_page_id: number;
  dashboard_id: number;
  order_index: number;
  created_at: string;
  dashboard?: any;
}

export class ReportPageService {
  static async getUserReportPages(): Promise<ReportPage[]> {
    try {
      return await ApiClient.get<ReportPage[]>('/report-pages/');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取报表页列表失败');
      }
      throw new Error('获取报表页列表失败');
    }
  }

  static async createReportPage(pageData: ReportPageCreateRequest): Promise<ReportPage> {
    try {
      return await ApiClient.post<ReportPage>('/report-pages/', pageData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建报表页失败');
      }
      throw new Error('创建报表页失败');
    }
  }

  static async getReportPage(pageId: number): Promise<ReportPage> {
    try {
      return await ApiClient.get<ReportPage>(`/report-pages/${pageId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取报表页失败');
      }
      throw new Error('获取报表页失败');
    }
  }

  static async updateReportPage(pageId: number, pageData: ReportPageUpdateRequest): Promise<ReportPage> {
    try {
      return await ApiClient.put<ReportPage>(`/report-pages/${pageId}`, pageData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新报表页失败');
      }
      throw new Error('更新报表页失败');
    }
  }

  static async addDashboardToReportPage(
    pageId: number,
    dashboardData: ReportPageDashboardCreateRequest
  ): Promise<ReportPageDashboard> {
    try {
      return await ApiClient.post<ReportPageDashboard>(`/report-pages/${pageId}/dashboards`, dashboardData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '添加仪表盘到报表页失败');
      }
      throw new Error('添加仪表盘到报表页失败');
    }
  }

  static async updateReportPageDashboard(
    rpdId: number,
    updateData: ReportPageDashboardUpdateRequest
  ): Promise<ReportPageDashboard> {
    try {
      return await ApiClient.put<ReportPageDashboard>(`/report-pages/dashboards/${rpdId}`, updateData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新报表页仪表盘失败');
      }
      throw new Error('更新报表页仪表盘失败');
    }
  }

  static async removeDashboardFromReportPage(rpdId: number): Promise<void> {
    try {
      await ApiClient.delete(`/report-pages/dashboards/${rpdId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '从报表页移除仪表盘失败');
      }
      throw new Error('从报表页移除仪表盘失败');
    }
  }

  static async deleteReportPage(pageId: number): Promise<void> {
    try {
      await ApiClient.delete(`/report-pages/${pageId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '删除报表页失败');
      }
      throw new Error('删除报表页失败');
    }
  }
}
