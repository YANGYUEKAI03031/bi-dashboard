// frontend/bi-dashboard/src/services/chartService.ts
// frontend/bi-dashboard/src/services/chartService.ts
import { AuthService } from './authService';
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
  table_name?: string;  // 新增：表名字段
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

  static async executeChartQuery(chartId: number, filterParams?: Record<string, any>): Promise<any[]> {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filterParams || {}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('执行图表查询失败:', error);
      throw error;
    }
  }

  static async getFilterOptions(dataSourceId: number, tableName: string, fieldName: string, limit?: number): Promise<string[]> {
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams({
        data_source_id: dataSourceId.toString(),
        table_name: tableName,
        field_name: fieldName,
      });
      if (limit) {
        params.append('limit', limit.toString());
      }

      const response = await fetch(`${API_BASE_URL}/visualization/charts/filter-options?${params}`, {
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
      return data.options || [];
    } catch (error) {
      console.error('获取筛选器选项失败:', error);
      throw error;
    }
  }

  // 从图表ID获取筛选器选项（自动从SQL中提取表名）
  static async getFilterOptionsFromChart(chartId: number, fieldName: string, limit?: number): Promise<{
    options: string[];
    data_source_id: number;
    table_name: string;
    field_name: string;
  }> {
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams({
        field_name: fieldName,
      });
      if (limit) {
        params.append('limit', limit.toString());
      }

      const response = await fetch(`${API_BASE_URL}/visualization/charts/filter-options-from-chart/${chartId}?${params}`, {
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

      return await response.json();
    } catch (error) {
      console.error('从图表获取筛选器选项失败:', error);
      throw error;
    }
  }
}