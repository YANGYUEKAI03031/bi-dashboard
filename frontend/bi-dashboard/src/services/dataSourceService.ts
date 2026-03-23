// frontend/bi-dashboard/src/services/dataSourceService.ts
import { AuthService } from './authService';

import { API_BASE_URL } from '../config/apiBaseUrl';

interface DataSource {
  id: string;   // 对应后端 Database.id（字符串形式）
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
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取数据源列表失败');
    }

    return response.json();
  }

  /**
   * 创建新的数据源
   */
  static async createDataSource(payload: CreateDataSourcePayload): Promise<DataSource> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/datasources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '创建数据源失败');
    }

    return response.json();
  }

  /**
   * 删除数据源（软删除，后端实际将 is_active 置为 False）
   */
  static async deleteDataSource(id: string): Promise<void> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/datasources/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '删除数据源失败');
    }
  }

  /**
   * 根据数据源ID获取该库下所有表
   */
  static async getTables(dataSourceId: string): Promise<TableInfo[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/${dataSourceId}/tables`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取表列表失败');
    }

    return response.json();
  }

  /**
   * 根据数据源ID和表名获取列信息
   */
  static async getTableColumns(dataSourceId: string, tableName: string): Promise<ColumnInfo[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/${dataSourceId}/tables/${tableName}/columns`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取列信息失败');
    }

    return response.json();
  }

  /**
   * 在指定数据源上执行只读查询
   */
  static async executeQuery(queryRequest: QueryRequest): Promise<QueryResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(queryRequest),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '查询执行失败');
    }

    return response.json();
  }

  /**
   * 测试数据源连接
   * - 可以传 data_source_id（测试已保存的数据源）
   * - 也可以传完整的连接配置（host/port/username/password/database_name）
   */
  static async testConnection(config: any): Promise<{ success: boolean; message: string }> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/datasources/test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '连接测试失败');
    }

    return response.json();
  }
}