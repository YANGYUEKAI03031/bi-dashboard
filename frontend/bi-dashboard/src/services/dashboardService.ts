// src/services/dashboardService.ts

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

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
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/`, {
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
      console.error('获取仪表盘列表失败:', error);
      throw error;
    }
  }

  static async createDashboard(dashboardData: DashboardCreateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/`, {
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
      console.error('创建仪表盘失败:', error);
      throw error;
    }
  }

  static async getDashboard(dashboardId: number): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
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
      console.error('获取仪表盘失败:', error);
      throw error;
    }
  }

  static async updateDashboard(dashboardId: number, dashboardData: DashboardUpdateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
        method: 'PUT',
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

      return await response.json();
    } catch (error) {
      console.error('更新仪表盘失败:', error);
      throw error;
    }
  }

  static async addChartToDashboard(dashboardId: number, cardData: DashboardCardCreateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}/cards`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cardData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('添加图表到仪表盘失败:', error);
      throw error;
    }
  }

  static async updateDashboardCard(cardId: number, updateData: DashboardCardUpdateRequest): Promise<any> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/cards/${cardId}`, {
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
      console.error('更新仪表盘卡片失败:', error);
      throw error;
    }
  }

  static async removeChartFromDashboard(cardId: number): Promise<void> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/dashboards/cards/${cardId}`, {
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
      console.error('从仪表盘移除图表失败:', error);
      throw error;
    }
  }
}