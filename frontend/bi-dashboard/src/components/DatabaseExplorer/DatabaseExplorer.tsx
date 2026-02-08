import React, { useState } from 'react';
import { useExistingDatabase } from '../../hooks/useExistingDatabase';
import { DatabaseConnectionForm } from './DatabaseConnectionForm';
import { QueryEditor } from './QueryEditor';
import { TableList } from './TableList';
import { DataTable } from './DataTable';
import { DatabaseStats } from './DatabaseStats';
import './DatabaseExplorer.css'; // 添加样式引用

export const DatabaseExplorer: React.FC = () => {
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM users LIMIT 100;');
  const [activeTab, setActiveTab] = useState<'query' | 'tables' | 'stats'>('query');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  
  const {
    tables,
    isLoading,
    error,
    isConnected,
    executeQuery,
    getTablePreview,
    getDatabaseStats,
    connectToDatabase
  } = useExistingDatabase();

  const [queryResult, setQueryResult] = useState<any>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const handleConnect = async (connectionInfo: any) => {
    const success = await connectToDatabase(connectionInfo);
    if (success) {
      setActiveTab('query');
    }
    return success;
  };

  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) return;
    
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    
    try {
      const result = await executeQuery(sqlQuery);
      if (result.success) {
        setQueryResult(result);
      } else {
        setQueryError(result.error || '查询失败');
      }
    } catch (err: any) {
      setQueryError(err.message || '查询失败');
    } finally {
      setQueryLoading(false);
    }
  };

  const handleTableSelect = async (tableName: string) => {
    setSelectedTable(tableName);
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    
    try {
      const result = await getTablePreview(tableName);
      if (result.success) {
        setQueryResult(result);
        setSqlQuery(`SELECT * FROM \`${tableName}\` LIMIT 100;`);
      } else {
        setQueryError(result.error || '获取表数据失败');
      }
    } catch (err: any) {
      setQueryError(err.message || '获取表数据失败');
    } finally {
      setQueryLoading(false);
    }
  };

  const handleLoadStats = async () => {
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    
    try {
      const stats = await getDatabaseStats();
      setQueryResult({ data: [stats] });
    } catch (err: any) {
      setQueryError(err.message || '获取统计信息失败');
    } finally {
      setQueryLoading(false);
    }
  };

  if (isLoading && !isConnected) {
    return (
      <div className="database-explorer">
        <div className="loading-state">
          正在连接数据库...
        </div>
      </div>
    );
  }

  return (
    <div className="database-explorer">
      <div className="explorer-header">
        <h2>数据库浏览器</h2>
        {isConnected && (
          <div className="connection-status">
            <span className="status-indicator connected"></span>
            已连接到数据库
          </div>
        )}
      </div>

      {!isConnected ? (
        <div className="connection-setup">
          <DatabaseConnectionForm 
            onConnect={handleConnect}
            isLoading={isLoading}
          />
        </div>
      ) : (
        <div className="explorer-layout">
          {/* 左侧面板 */}
          <div className="sidebar">
            <div className="table-search-box">
              <input
                type="text"
                placeholder="搜索表名..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="table-search-input"
              />
            </div>
            
            <TableList 
              tables={tables.filter(table => 
                table.name.toLowerCase().includes(tableSearch.toLowerCase())
              )}
              selectedTable={selectedTable}
              onSelectTable={handleTableSelect}
              loading={isLoading}
            />
          </div>

          {/* 主内容区域 */}
          <div className="main-content">
            {/* 查询标签页 */}
            {activeTab === 'query' && (
              <div className="query-tab">
                <QueryEditor 
                  value={sqlQuery}
                  onChange={setSqlQuery}
                  onExecute={handleExecuteQuery}
                  loading={queryLoading}
                />
                
                {queryError && (
                  <div className="error-message">
                    错误: {queryError}
                  </div>
                )}
                
                {queryResult && queryResult.success !== false && (
                  <DataTable 
                    data={queryResult.data}
                    columns={queryResult.columns}
                    rowCount={queryResult.row_count}
                    executionTime={queryResult.executionTime || 0}
                  />
                )}
              </div>
            )}

            {/* 表结构标签页 */}
            {activeTab === 'tables' && (
              <div className="tables-tab">
                <TableList 
                  tables={tables.filter(table => 
                    table.name.toLowerCase().includes(tableSearch.toLowerCase())
                  )}
                  selectedTable={selectedTable}
                  onSelectTable={handleTableSelect}
                  loading={isLoading}
                  expandedView={true}
                />
                
                {queryError && (
                  <div className="error-message">
                    错误: {queryError}
                  </div>
                )}
                
                {queryResult && queryResult.success !== false && (
                  <DataTable 
                    data={queryResult.data}
                    columns={queryResult.columns}
                    rowCount={queryResult.row_count}
                    executionTime={queryResult.executionTime || 0}
                  />
                )}
              </div>
            )}

             {/* 统计标签页 */}
            {activeTab === 'stats' && (
              <div className="stats-tab">
                <button 
                  onClick={handleLoadStats}
                  disabled={queryLoading}
                  className="load-stats-btn"
                >
                  {queryLoading ? '加载中...' : '加载统计信息'}
                </button>
                
                {queryError && (
                  <div className="error-message">
                    错误: {queryError}
                  </div>
                )}
                
                {queryResult && (
                  <DatabaseStats data={queryResult.data[0]} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};