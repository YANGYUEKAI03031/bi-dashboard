// src/services/vizDataSourceService.ts
import axios from 'axios';

// API基础URL - 使用环境变量
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000/api/v1';

export interface VizDataSource {
  name: string;
  type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  is_active: boolean;
}

export interface TableInfo {
  name: string;
  rows?: number;
  columns?: string[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  is_nullable: boolean;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export interface QueryRequest {
  sql: string;
  datasource_type: string;
  connection_config?: {
    type: string;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
}

export interface QueryResponse {
  success: boolean;
  data: Record<string, any>[];
  columns: string[];
  row_count: number;
  execution_time: number;
  error?: string;
}

class VizDataSourceService {
  private baseUrl = `${API_BASE_URL}/visualization/datasources`;

  /**
   * 获取可视化专用的数据源列表
   */
   
  async getDataSources(): Promise<VizDataSource[]> {
  try {
    const response = await axios.get(`${this.baseUrl}/`);
    return response.data;
  } catch (error) {
    console.error('获取数据源失败:', error);
    // 移除id字段，使用name作为唯一标识
    return [{
      name: '默认MySQL连接',
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: '603031',
      database: 'users',
      is_active: true
    }];
  }
}

  /**
   * 测试数据库连接
   */
  async testConnection(config: Omit<VizDataSource, 'name' | 'is_active'>): Promise<TestConnectionResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/test-connection`, config);
      return response.data;
    } catch (error) {
      console.error('连接测试失败:', error);
      return {
        success: false,
        message: '网络错误或服务器不可用'
      };
    }
  }

  /**
   * 获取指定数据源类型的表列表
   */
  async getTables(datasourceType: string): Promise<TableInfo[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${datasourceType}/tables`);
      return response.data;
    } catch (error) {
      console.error('获取表列表失败:', error);
      throw new Error('获取表列表失败');
    }
  }

  /**
   * 获取指定表的列信息
   */
  async getTableColumns(datasourceType: string, tableName: string): Promise<ColumnInfo[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${datasourceType}/tables/${tableName}/columns`);
      return response.data;
    } catch (error) {
      console.error('获取列信息失败:', error);
      throw new Error('获取列信息失败');
    }
  }

    /**
   * 执行真实数据库查询
   */
   async executeQuery(request: QueryRequest): Promise<QueryResponse> {
    try {
      const response = await axios.post(`${this.baseUrl}/query`, request);  // 改为 /query
      return response.data;
    } catch (error) {
      console.error('执行查询失败:', error);
      return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
          data: [],
          columns: [],
          row_count: 0,
          execution_time: 0
      };
    }
  }

  /**
   * 快速预览表数据
   */
  async previewTableData(datasourceType: string, tableName: string, limit: number = 100): Promise<QueryResponse> {
    const sql = `SELECT * FROM \`${tableName}\` LIMIT ${limit}`;
    return this.executeQuery({
      sql,
      datasource_type: datasourceType
    });
  }
}

// 导出单例实例
export const vizDataSourceService = new VizDataSourceService();