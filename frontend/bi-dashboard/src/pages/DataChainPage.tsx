// frontend/bi-dashboard/src/pages/DataChainPage.tsx
import React, { useState, useEffect } from 'react';
import './DataChainPage.css';
import NodeAnalysisModal from './NodeAnalysisModal';

interface DataTable {
  name: string;
  rows: number;
  columns: number;
  created_at: string;
}

interface DataRow {
  [key: string]: any;
}

export const DataChainPage: React.FC = () => {
  const [tables, setTables] = useState<DataTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isNodeAnalysisOpen, setIsNodeAnalysisOpen] = useState(false);

  // 获取数据库表列表
  useEffect(() => {
    fetchTableList();
  }, []);

  const fetchTableList = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:8000/api/v1/data/tables');
      const data = await response.json();
      // 过滤掉不需要显示的表格
      const filteredTables = data.tables.filter((table: DataTable) => 
        !['useraccount','node_executions', 'workflows'].includes(table.name)
      );
      setTables(filteredTables || []);
    } catch (error) {
      console.error('获取表列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTableSelect = async (tableName: string) => {
    setSelectedTable(tableName);
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:8000/api/v1/data/table/${tableName}/preview`);
      const data = await response.json();
      setTableData(data.rows || []);
    } catch (error) {
      console.error('获取表数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartAnalysis = () => {
    // 不再检查 selectedTable，直接打开分析模态框
    setIsNodeAnalysisOpen(true);
  };

  const handleCloseAnalysis = () => {
    setIsNodeAnalysisOpen(false);
  };

  return (
    <div className="data-chain-page">
      <div className="page-header">
        <h1>数据链分析</h1>
        <p>选择数据表并创建分析链路</p>
      </div>

      <div className="data-chain-container">
        {/* 左侧面板 - 表列表 */}
        <div className="panel table-list-panel">
          <h2>数据表</h2>
          {loading && <div className="loading">加载中...</div>}
          <div className="table-list">
            {tables.map(table => (
              <div 
                key={table.name}
                className={`table-item ${selectedTable === table.name ? 'selected' : ''}`}
                onClick={() => handleTableSelect(table.name)}
              >
                <div className="table-name">{table.name}</div>
                <div className="table-info">
                  <span>{table.rows} 行</span>
                  <span>{table.columns} 列</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间面板 - 数据预览 */}
        <div className="panel data-preview-panel">
          <h2>数据预览</h2>
          {selectedTable ? (
            <div className="data-preview">
              <div className="preview-header">
                <h3>表: {selectedTable}</h3>
              </div>
              <div className="preview-content">
                {tableData.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        {Object.keys(tableData[0]).map(key => (
                          <th key={key}>{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.slice(0, 5).map((row, index) => (
                        <tr key={index}>
                          {Object.values(row).map((value, i) => (
                            <td key={i}>{String(value)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="no-data">暂无数据</div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-selection">请选择一个数据表</div>
          )}
        </div>

        {/* 右侧面板 - 分析控制 */}
        <div className="panel analysis-control-panel">
          <h2>分析控制</h2>
          
          <div className="analysis-description">
            <p>点击"开始分析"按钮进入节点式分析界面。可以在分析界面中选择数据源。</p>
          </div>

          <div className="analysis-actions">
            <button 
              className="primary-button"
              onClick={handleStartAnalysis}
              // 移除了 disabled={!selectedTable} 条件
            >
              开始分析
            </button>
            <button className="secondary-button">
              保存工作流
            </button>
          </div>
        </div>
      </div>

      {/* 节点式分析模态框 */}
      <NodeAnalysisModal 
        isOpen={isNodeAnalysisOpen} 
        onClose={handleCloseAnalysis}
        selectedTable={selectedTable}
      />
    </div>
  );
};