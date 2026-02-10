import axios from 'axios';
import { ChartConfig } from '../services/chartService';

// API基础URL
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000/api/v1';

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
});

export interface ChartCreateRequest {
  name: string;
  description?: string;
  chart_type: string;
  config: ChartConfig;
  data_source_id: number;
  table_name: string;  // 改为表名而不是SQL
}

export interface ChartUpdateRequest {
  name?: string;
  description?: string;
  chart_type?: string;
  config?: ChartConfig;
  table_name?: string;
}

export interface ChartResponse {
  id: number;
  name: string;
  description?: string;
  chart_type: string;
  config: any;
  data_source_id: number;
  table_name: string;
  created_at: string;
  updated_at: string;
}

class ChartApiService {
  private baseUrl = '/charts';  // 确保路径正确

  async getCharts(skip: number = 0, limit: number = 100): Promise<ChartResponse[]> {
    try {
      const response = await apiClient.get<ChartResponse[]>(this.baseUrl, {
        params: { skip, limit }
      });
      return response.data;
    } catch (error) {
      console.error('获取图表列表失败:', error);
      throw new Error('获取图表列表失败');
    }
  }

  async getChart(chartId: number): Promise<ChartResponse> {
    try {
      const response = await apiClient.get<ChartResponse>(`${this.baseUrl}/${chartId}`);
      return response.data;
    } catch (error) {
      console.error('获取图表失败:', error);
      throw new Error('获取图表失败');
    }
  }

  async createChart(chartData: ChartCreateRequest): Promise<ChartResponse> {
    try {
      const response = await apiClient.post<ChartResponse>(this.baseUrl, chartData);
      return response.data;
    } catch (error) {
      console.error('创建图表失败:', error);
      throw new Error('创建图表失败');
    }
  }

  async updateChart(chartId: number, chartData: ChartUpdateRequest): Promise<ChartResponse> {
    try {
      const response = await apiClient.put<ChartResponse>(`${this.baseUrl}/${chartId}`, chartData);
      return response.data;
    } catch (error) {
      console.error('更新图表失败:', error);
      throw new Error('更新图表失败');
    }
  }

  async deleteChart(chartId: number): Promise<void> {
    try {
      await apiClient.delete(`${this.baseUrl}/${chartId}`);
    } catch (error) {
      console.error('删除图表失败:', error);
      throw new Error('删除图表失败');
    }
  }
}

export const chartApiService = new ChartApiService();