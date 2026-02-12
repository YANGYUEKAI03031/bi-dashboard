// frontend/bi-dashboard/src/services/chartService.ts
import { AuthService } from './authService';  // 添加这行导入

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

interface ChartCreateRequest {
  name: string;
  description?: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;  // 恢复原始字段名
  creator_id: number;   // 恢复原始字段名
  is_public?: boolean;
}

interface ChartResponse {
  id: number;
  name: string;
  description?: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;  // 恢复原始字段名
  creator_id: number;   // 恢复原始字段名
  created_at: string;
  updated_at: string;
}

export class ChartService {
  static async createChart(chartData: ChartCreateRequest): Promise<ChartResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/charts/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chartData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '创建图表失败');
    }

    return response.json();
  }

  static async getChart(chartId: number): Promise<ChartResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取图表失败');
    }

    return response.json();
  }

  static async getUserCharts(): Promise<ChartResponse[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/charts/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取图表列表失败');
    }

    return response.json();
  }

  static async updateChart(chartId: number, updateData: Partial<ChartCreateRequest>): Promise<ChartResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '更新图表失败');
    }

    return response.json();
  }

  static async deleteChart(chartId: number): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '删除图表失败');
    }
  }

  // 在 ChartService.ts 中添加数据验证
static async executeChartQuery(chartId: number): Promise<any[]> {
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    // 确保返回数组格式
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.error('执行图表查询失败:', error);
    throw error;
  }
}
}