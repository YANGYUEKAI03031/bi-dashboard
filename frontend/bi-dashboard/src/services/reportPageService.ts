// src/services/reportPageService.ts

import { API_BASE_URL } from '../config/apiBaseUrl';

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
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('获取报表页列表失败:', error);
      throw error;
    }
  }

  static async createReportPage(pageData: ReportPageCreateRequest): Promise<ReportPage> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pageData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('创建报表页失败:', error);
      throw error;
    }
  }

  static async getReportPage(pageId: number): Promise<ReportPage> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/${pageId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('获取报表页失败:', error);
      throw error;
    }
  }

  static async updateReportPage(pageId: number, pageData: ReportPageUpdateRequest): Promise<ReportPage> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/${pageId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pageData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('更新报表页失败:', error);
      throw error;
    }
  }

  static async addDashboardToReportPage(
    pageId: number,
    dashboardData: ReportPageDashboardCreateRequest
  ): Promise<ReportPageDashboard> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/${pageId}/dashboards`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dashboardData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('添加仪表盘到报表页失败:', error);
      throw error;
    }
  }

  static async updateReportPageDashboard(
    rpdId: number,
    updateData: ReportPageDashboardUpdateRequest
  ): Promise<ReportPageDashboard> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/dashboards/${rpdId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('更新报表页仪表盘失败:', error);
      throw error;
    }
  }

  static async removeDashboardFromReportPage(rpdId: number): Promise<void> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/dashboards/${rpdId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('从报表页移除仪表盘失败:', error);
      throw error;
    }
  }

  static async deleteReportPage(pageId: number): Promise<void> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/report-pages/${pageId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('删除报表页失败:', error);
      throw error;
    }
  }
}
