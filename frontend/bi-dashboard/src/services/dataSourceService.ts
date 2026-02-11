// frontend/bi-dashboard/src/services/dataSourceService.ts
import { AuthService } from './authService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1';

interface DataSource {
  id: string;
  name: string;
  type: string;
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
  data_source_id: string;
  query: string;
}

interface QueryResponse {
  columns: string[];
  rows: Record<string, any>[];
  row_count: number;
}

export class DataSourceService {
  static async getDataSources(): Promise<DataSource[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    // 修正：应该是 /visualization/ 而不是 /visualization/datasources
    const response = await fetch(`${API_BASE_URL}/visualization/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取数据源列表失败');
    }

    return response.json();
  }

  static async getTables(dataSourceType: string): Promise<TableInfo[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    // 修正：应该是 /visualization/{type}/tables 而不是 /visualization/datasources/{type}/tables
    const response = await fetch(`${API_BASE_URL}/visualization/${dataSourceType}/tables`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取表列表失败');
    }

    return response.json();
  }

  static async getTableColumns(dataSourceType: string, tableName: string): Promise<ColumnInfo[]> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    // 修正：应该是 /visualization/{type}/tables/{name}/columns
    const response = await fetch(`${API_BASE_URL}/visualization/${dataSourceType}/tables/${tableName}/columns`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || '获取列信息失败');
    }

    return response.json();
  }

  static async executeQuery(queryRequest: QueryRequest): Promise<QueryResponse> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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

  static async testConnection(config: any): Promise<{ success: boolean; message: string }> {
    const token = AuthService.getAuthToken();
    if (!token) {
      throw new Error('用户未认证');
    }

    const response = await fetch(`${API_BASE_URL}/visualization/datasources/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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