import { useState, useEffect } from 'react';
import axios from 'axios';
import type { TableInfo, TableColumn } from '../services/existingDatabaseService';

// API基础配置
const API_BASE_URL = 'http://localhost:8000/api/v1';

interface DatabaseConnectionInfo {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

interface ApiTableInfo {
  name: string;
  rows?: number;
  size_mb?: number;
}

interface QueryResult {
  success: boolean;
  data: any[];
  columns: string[];
  row_count: number;
  executionTime?: number;
  error?: string;
}

interface UseExistingDatabaseReturn {
  tables: TableInfo[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  executeQuery: (sql: string, connectionInfo?: DatabaseConnectionInfo) => Promise<QueryResult>;
  getTablePreview: (tableName: string, limit?: number, connectionInfo?: DatabaseConnectionInfo) => Promise<QueryResult>;
  getDatabaseStats: (connectionInfo?: DatabaseConnectionInfo) => Promise<any>;
  getTableSchema: (tableName: string, connectionInfo?: DatabaseConnectionInfo) => Promise<any>;
  connectToDatabase: (connectionInfo: DatabaseConnectionInfo) => Promise<boolean>;
}

// 转换API返回的表信息到标准TableInfo格式
const convertApiTableToTableInfo = (apiTable: ApiTableInfo): TableInfo => {
  // 这里需要根据实际情况构造columns信息
  // 由于API可能不返回详细的列信息，我们创建一个基本的结构
  const columns: TableColumn[] = [
    { name: 'id', type: 'INT', nullable: false, primaryKey: true },
    { name: 'name', type: 'VARCHAR(255)', nullable: false, primaryKey: false },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false, primaryKey: false }
  ];
  
  return {
    name: apiTable.name,
    columns: columns,
    rowCount: apiTable.rows || 0,
    description: `表 ${apiTable.name}`
  };
};

export const useExistingDatabase = (): UseExistingDatabaseReturn => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // 初始化连接
  useEffect(() => {
    const initializeConnection = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // 尝试获取默认数据库的表列表
        const response = await axios.get(`${API_BASE_URL}/database/tables`);
        
        if (response.data.success) {
          // 转换API返回的数据格式
          const convertedTables = response.data.tables.map(convertApiTableToTableInfo);
          setTables(convertedTables);
          setIsConnected(true);
        } else {
          setError(response.data.error || '连接数据库失败');
        }
      } catch (err: any) {
        console.error('数据库连接错误:', err);
        setError(err.response?.data?.detail || err.message || '连接失败');
      } finally {
        setIsLoading(false);
      }
    };

    initializeConnection();
  }, []);

  const connectToDatabase = async (connectionInfo: DatabaseConnectionInfo): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await axios.get(`${API_BASE_URL}/database/tables`, {
        params: { connection_info: connectionInfo }
      });
      
      if (response.data.success) {
        // 转换API返回的数据格式
        const convertedTables = response.data.tables.map(convertApiTableToTableInfo);
        setTables(convertedTables);
        setIsConnected(true);
        return true;
      } else {
        setError(response.data.error || '连接失败');
        return false;
      }
    } catch (err: any) {
      console.error('数据库连接错误:', err);
      setError(err.response?.data?.detail || err.message || '连接失败');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const executeQuery = async (
    sql: string, 
    connectionInfo?: DatabaseConnectionInfo
  ): Promise<QueryResult> => {
    try {
      const response = await axios.post(`${API_BASE_URL}/database/query`, {
        sql,
        connection_info: connectionInfo
      });
      
      return response.data;
    } catch (err: any) {
      console.error('查询执行错误:', err);
      return {
        success: false,
        data: [],
        columns: [],
        row_count: 0,
        error: err.response?.data?.detail || err.message || '查询失败'
      };
    }
  };

  const getTablePreview = async (
    tableName: string,
    limit: number = 100,
    connectionInfo?: DatabaseConnectionInfo
  ): Promise<QueryResult> => {
    try {
      const response = await axios.post(`${API_BASE_URL}/database/table-preview/${tableName}`, {
        table_name: tableName,
        limit,
        connection_info: connectionInfo
      });
      
      return response.data;
    } catch (err: any) {
      console.error('获取表预览错误:', err);
      return {
        success: false,
        data: [],
        columns: [],
        row_count: 0,
        error: err.response?.data?.detail || err.message || '获取预览失败'
      };
    }
  };

  const getDatabaseStats = async (connectionInfo?: DatabaseConnectionInfo) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/database/tables`, {
        params: { connection_info: connectionInfo }
      });
      
      if (response.data.success) {
        return {
          tableCount: response.data.tables.length,
          totalRows: response.data.tables.reduce((sum: number, table: ApiTableInfo) => sum + (table.rows || 0), 0),
          sizeMB: response.data.tables.reduce((sum: number, table: ApiTableInfo) => sum + (table.size_mb || 0), 0),
          database: response.data.database_name
        };
      } else {
        throw new Error(response.data.error || '获取统计信息失败');
      }
    } catch (err: any) {
      console.error('获取统计信息错误:', err);
      throw new Error(err.response?.data?.detail || err.message || '获取统计信息失败');
    }
  };

  const getTableSchema = async (
    tableName: string,
    connectionInfo?: DatabaseConnectionInfo
  ) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/database/table-schema/${tableName}`, {
        params: { connection_info: connectionInfo }
      });
      
      return response.data;
    } catch (err: any) {
      console.error('获取表结构错误:', err);
      throw new Error(err.response?.data?.detail || err.message || '获取表结构失败');
    }
  };

  return {
    tables,
    isLoading,
    error,
    isConnected,
    executeQuery,
    getTablePreview,
    getDatabaseStats,
    getTableSchema,
    connectToDatabase
  };
};