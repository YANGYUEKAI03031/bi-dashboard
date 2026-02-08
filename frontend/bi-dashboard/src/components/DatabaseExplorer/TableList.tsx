// src/components/DatabaseExplorer/TableList.tsx
import React from 'react';
import type { TableInfo } from '../../services/existingDatabaseService';
import './DatabaseExplorer.css'; // 添加样式引用

interface TableListProps {
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (tableName: string) => void;
  loading: boolean;
  expandedView?: boolean;
}

export const TableList: React.FC<TableListProps> = ({
  tables,
  selectedTable,
  onSelectTable,
  loading,
  expandedView = false
}) => {
  if (loading) {
    return (
      <div className="table-list loading">
        <div className="loading-spinner"></div>
        <p>加载表列表中...</p>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="table-list empty">
        <p>没有找到数据表</p>
      </div>
    );
  }

  return (
    <div className={`table-list ${expandedView ? 'expanded' : ''}`}>
      <h3>{expandedView ? '表结构详情' : '数据表列表'}</h3>
      <ul className="table-items">
        {tables.map((table) => (
          <li
            key={table.name}
            className={`table-item ${selectedTable === table.name ? 'selected' : ''}`}
            onClick={() => onSelectTable(table.name)}
          >
            <span className="table-name">{table.name}</span>
            <span className="table-row-count">{table.rowCount?.toLocaleString() || '0'} 行</span>
          </li>
        ))}
      </ul>
    </div>
  );
};