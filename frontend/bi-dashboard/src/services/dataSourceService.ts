// frontend/bi-dashboard/src/services/dataSourceService.ts
import { ApiClient, ApiError } from './apiClient';

interface DataSource {
  id: string; // 对应后端 Database.id（字符串形式）
  name: string;
  type: string; // mysql / ...
}

export interface CreateDataSourcePayload {
  name: string;
  engine?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database_name: string;
  description?: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  is_nullable: boolean;
  default_value: string | null;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

interface QueryRequest {
  data_source_id: string; // 必须是具体的数据源ID
  query: string;
}

interface QueryResponse {
  columns: string[];
  rows: Record<string, any>[];
  row_count: number;
}

export class DataSourceService {
  /**
   * 获取所有可用数据源（基于 users.databases 表）
   */
  static async getDataSources(): Promise<DataSource[]> {
    try {
      return await ApiClient.get<DataSource[]>('/visualization/');
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取数据源列表失败');
      }
      throw new Error('获取数据源列表失败');
    }
  }

  /**
   * 创建新的数据源
   */
  static async createDataSource(payload: CreateDataSourcePayload): Promise<DataSource> {
    try {
      return await ApiClient.post<DataSource>('/visualization/datasources', payload);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '创建数据源失败');
      }
      throw new Error('创建数据源失败');
    }
  }

  /**
   * 删除数据源（软删除，后端实际将 is_active 置为 False）
   */
  static async deleteDataSource(id: string): Promise<void> {
    try {
      await ApiClient.delete(`/visualization/datasources/${id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '删除数据源失败');
      }
      throw new Error('删除数据源失败');
    }
  }

  /**
   * 根据数据源ID获取该库下所有表
   */
  static async getTables(dataSourceId: string): Promise<TableInfo[]> {
    try {
      return await ApiClient.get<TableInfo[]>(`/visualization/${dataSourceId}/tables`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取表列表失败');
      }
      throw new Error('获取表列表失败');
    }
  }

  /**
   * 根据数据源ID和表名获取列信息
   */
  static async getTableColumns(dataSourceId: string, tableName: string): Promise<ColumnInfo[]> {
    try {
      return await ApiClient.get<ColumnInfo[]>(`/visualization/${dataSourceId}/tables/${tableName}/columns`);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '获取列信息失败');
      }
      throw new Error('获取列信息失败');
    }
  }

  /**
   * 在指定数据源上执行只读查询
   */
  static async executeQuery(queryRequest: QueryRequest): Promise<QueryResponse> {
    try {
      return await ApiClient.post<QueryResponse>('/visualization/query', queryRequest);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '查询执行失败');
      }
      throw new Error('查询执行失败');
    }
  }

  /**
   * 测试数据源连接
   * - 可以传 data_source_id（测试已保存的数据源）
   * - 也可以传完整的连接配置（host/port/username/password/database_name）
   */
  static async testConnection(config: any): Promise<{ success: boolean; message: string }> {
    try {
      return await ApiClient.post<{ success: boolean; message: string }>('/visualization/datasources/test', config);
    } catch (error) {
      if (error instanceof ApiError) {
        throw new Error(error.message || '连接测试失败');
      }
      throw new Error('连接测试失败');
    }
  }
}
