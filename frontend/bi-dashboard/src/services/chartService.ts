// frontend/bi-dashboard/src/services/chartService.ts
import { AuthService } from './authService';
import { API_BASE_URL } from '../config/apiBaseUrl';

interface ChartCreateRequest {
  name: string;
  description?: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id: number;
  is_public?: boolean;
}

interface ChartResponse {
  id: number;
  name: string;
  description?: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id: number;
  table_name?: string;
  created_at: string;
  updated_at: string;
}

interface FilterOptionsFromChartResult {
  options: string[];
  data_source_id: number;
  table_name: string;
  field_name: string;
}

export class ChartService {
  static async createChart(chartData: ChartCreateRequest): Promise<ChartResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/visualization/charts/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取图表失败');
    }
    return response.json();
  }

  static async getUserCharts(): Promise<ChartResponse[]> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/visualization/charts/`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取图表列表失败');
    }
    return response.json();
  }

  static async updateChart(
    chartId: number,
    updateData: Partial<ChartCreateRequest>,
  ): Promise<ChartResponse> {
    const token = AuthService.getAuthToken();
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    if (!token) throw new Error('用户未认证');

    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '删除图表失败');
    }
  }

  static async executeChartQuery(
    chartId: number,
    filterParams?: Record<string, any>,
  ): Promise<any[]> {
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/visualization/charts/${chartId}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(filterParams || {}),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.data;
  }

  /** 批量查询多个图表数据（一次请求获取所有图表） */
  static async executeBatchChartQuery(
    requests: { chartId: number; filterParams?: Record<string, any> }[]
  ): Promise<{ chartId: number; data: any[]; error?: string }[]> {
    const token = localStorage.getItem('authToken');
    const payload = requests.map(r => ({
      chart_id: r.chartId,
      filter_params: r.filterParams || {},
    }));
    const response = await fetch(`${API_BASE_URL}/visualization/charts/batch-query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }
    const result = await response.json();
    // 转换为 {chartId, data, error} 格式
    return (result.results || []).map((r: any) => ({
      chartId: r.chart_id,
      data: r.data || [],
      error: r.error,
    }));
  }

  /**
   * 获取筛选器的可选项列表（直接指定数据源/表/字段）
   * @param filterConditions  级联筛选条件，key 格式为 filterId_fieldName
   */
  static async getFilterOptions(
    dataSourceId: number,
    tableName: string,
    fieldName: string,
    limit?: number,
    filterConditions?: Record<string, any>,
  ): Promise<string[]> {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams({
      data_source_id: dataSourceId.toString(),
      table_name: tableName,
      field_name: fieldName,
    });
    if (limit) params.append('limit', limit.toString());
    if (filterConditions && Object.keys(filterConditions).length > 0) {
      params.append('filter_conditions', JSON.stringify(filterConditions));
    }

    const response = await fetch(
      `${API_BASE_URL}/visualization/charts/filter-options?${params}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.options || [];
  }

  /**
   * 从图表 ID 自动提取表名并获取筛选器选项，支持级联条件
   * @param filterConditions  级联筛选条件，key 格式为 filterId_fieldName
   */
  static async getFilterOptionsFromChart(
    chartId: number,
    fieldName: string,
    limit?: number,
    filterConditions?: Record<string, any>,
  ): Promise<FilterOptionsFromChartResult> {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams({ field_name: fieldName });
    if (limit) params.append('limit', limit.toString());
    if (filterConditions && Object.keys(filterConditions).length > 0) {
      params.append('filter_conditions', JSON.stringify(filterConditions));
    }

    const response = await fetch(
      `${API_BASE_URL}/visualization/charts/filter-options-from-chart/${chartId}?${params}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}
