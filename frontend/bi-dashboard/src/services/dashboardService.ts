// frontend/bi-dashboard/src/services/dashboardService.ts
import { AuthService } from './authService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

interface DashboardCreateRequest {
  name: string;
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

interface DashboardResponse {
  id: number;
  name: string;
  description?: string;
  layout?: any;
  settings?: any;
  creator_id: number;
  is_public: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  cards: any[];
}

export class DashboardService {
  static async createDashboard(dashboardData: DashboardCreateRequest): Promise<DashboardResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

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
      throw new Error(errorData.detail || '创建仪表板失败');
    }

    return response.json();
  }

  static async getDashboard(dashboardId: number): Promise<DashboardResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/dashboards/${dashboardId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取仪表板失败');
    }

    return response.json();
  }

  static async getUserDashboards(): Promise<DashboardResponse[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/dashboards/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取仪表板列表失败');
    }

    return response.json();
  }

  static async addChartToDashboard(dashboardId: number, cardData: DashboardCardCreateRequest): Promise<any> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

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
      throw new Error(errorData.detail || '添加图表到仪表板失败');
    }

    return response.json();
  }

  static async updateDashboardCard(cardId: number, updateData: DashboardCardUpdateRequest): Promise<any> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

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
      throw new Error(errorData.detail || '更新仪表板卡片失败');
    }

    return response.json();
  }

  static async removeChartFromDashboard(cardId: number): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/dashboards/cards/${cardId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '从仪表板移除图表失败');
    }
  }
}