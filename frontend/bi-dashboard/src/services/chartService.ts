// frontend/bi-dashboard/src/services/chartService.ts
import { ApiClient, ApiError } from './apiClient';

interface ChartCreateRequest {
  name: string;
  description?: string;
  chart_type: string;
  dataset_query: any;
  visualization_settings: any;
  database_id: number;
  creator_id: number;
  is_public?: boolean;
  /** 源表展示名；管道图可由前端从管道解析后写入 */
  table_name?: string | null;
  pipeline_id?: number | null;
  focus_node_id?: string | null;
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
  pipeline_id?: number | null;
  focus_node_id?: string | null;
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
    try {
      return await ApiClient.post<ChartResponse>('/visualization/charts/', chartData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建图表失败');
      }
      throw new Error('创建图表失败');
    }
  }

  static async getChart(chartId: number): Promise<ChartResponse> {
    try {
      return await ApiClient.get<ChartResponse>(`/visualization/charts/${chartId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取图表失败');
      }
      throw new Error('获取图表失败');
    }
  }

  static async getUserCharts(): Promise<ChartResponse[]> {
    try {
      return await ApiClient.get<ChartResponse[]>('/visualization/charts/');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取图表列表失败');
      }
      throw new Error('获取图表列表失败');
    }
  }

  static async updateChart(chartId: number, updateData: Partial<ChartCreateRequest>): Promise<ChartResponse> {
    try {
      return await ApiClient.put<ChartResponse>(`/visualization/charts/${chartId}`, updateData);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '更新图表失败');
      }
      throw new Error('更新图表失败');
    }
  }

  static async deleteChart(chartId: number): Promise<void> {
    try {
      await ApiClient.delete(`/visualization/charts/${chartId}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '删除图表失败');
      }
      throw new Error('删除图表失败');
    }
  }

  static async executeChartQuery(chartId: number, filterParams?: Record<string, any>): Promise<any[]> {
    try {
      const data = await ApiClient.post<{ data: any[] }>(`/visualization/charts/${chartId}/query`, filterParams || {});
      return data.data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message);
      }
      throw new Error('查询图表失败');
    }
  }

  /** 批量查询多个图表数据（一次请求获取所有图表） */
  static async executeBatchChartQuery(
    requests: { chartId: number; filterParams?: Record<string, any> }[],
  ): Promise<{ chartId: number; data: any[]; error?: string }[]> {
    try {
      const payload = requests.map((r) => ({
        chart_id: r.chartId,
        filter_params: r.filterParams || {},
      }));
      const result = await ApiClient.post<{ results: any[] }>('/visualization/charts/batch-query', payload);
      // 转换为 {chartId, data, error} 格式
      return (result.results || []).map((r: any) => ({
        chartId: r.chart_id,
        data: r.data || [],
        error: r.error,
      }));
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message);
      }
      throw new Error('批量查询失败');
    }
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
    try {
      const params = new URLSearchParams({
        data_source_id: dataSourceId.toString(),
        table_name: tableName,
        field_name: fieldName,
      });
      if (limit) params.append('limit', limit.toString());
      if (filterConditions && Object.keys(filterConditions).length > 0) {
        params.append('filter_conditions', JSON.stringify(filterConditions));
      }

      const data = await ApiClient.get<{ options: string[] }>(`/visualization/charts/filter-options?${params}`);
      return data.options || [];
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message);
      }
      throw new Error('获取筛选选项失败');
    }
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
    try {
      const params = new URLSearchParams({ field_name: fieldName });
      if (limit) params.append('limit', limit.toString());
      if (filterConditions && Object.keys(filterConditions).length > 0) {
        params.append('filter_conditions', JSON.stringify(filterConditions));
      }

      return await ApiClient.get<FilterOptionsFromChartResult>(
        `/visualization/charts/filter-options-from-chart/${chartId}?${params}`,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message);
      }
      throw new Error('获取筛选选项失败');
    }
  }
}
