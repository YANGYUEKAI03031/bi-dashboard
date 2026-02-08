// src/components/DatabaseExplorer/DataTable.tsx
import React, { useState, useMemo } from 'react';
import './DatabaseExplorer.css'; // 添加样式引用

interface DataTableProps {
  data: any[] | any[][];
  columns: string[];
  rowCount: number;
  executionTime: number;
}

interface FilterState {
  globalSearch: string;
  columnFilters: Record<string, string>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

export const DataTable: React.FC<DataTableProps> = ({
  data,
  columns,
  rowCount,
  executionTime
}) => {
  const [filterState, setFilterState] = useState<FilterState>({
    globalSearch: '',
    columnFilters: {},
    sortColumn: null,
    sortDirection: null
  });

  // 标准化数据格式为二维数组
  const normalizedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // 如果已经是二维数组格式，直接返回
    if (Array.isArray(data[0]) && data[0].length > 0) {
      return data as any[][];
    }
    
    // 如果是对象数组格式，转换为二维数组
    if (typeof data[0] === 'object' && data[0] !== null) {
      return (data as any[]).map(row => 
        columns.map(col => row[col])
      );
    }
    
    // 其他情况返回空数组
    return [];
  }, [data, columns]);

  // 处理过滤后的数据
  const filteredAndSortedData = useMemo(() => {
    let result = [...normalizedData];

    // 全局搜索
    if (filterState.globalSearch) {
      const searchTerm = filterState.globalSearch.toLowerCase();
      result = result.filter(row => 
        row.some(cell => 
          cell !== null && 
          String(cell).toLowerCase().includes(searchTerm)
        )
      );
    }

    // 列筛选
    Object.entries(filterState.columnFilters).forEach(([columnIndex, filterValue]) => {
      if (filterValue) {
        const columnIndexNum = parseInt(columnIndex);
        const filterTerm = filterValue.toLowerCase();
        result = result.filter(row => 
          row[columnIndexNum] !== null && 
          String(row[columnIndexNum]).toLowerCase().includes(filterTerm)
        );
      }
    });

    // 排序
    if (filterState.sortColumn && filterState.sortDirection) {
      const columnIndex = columns.indexOf(filterState.sortColumn);
      result.sort((a, b) => {
        const aValue = a[columnIndex];
        const bValue = b[columnIndex];
        
        if (aValue === null) return filterState.sortDirection === 'asc' ? -1 : 1;
        if (bValue === null) return filterState.sortDirection === 'asc' ? 1 : -1;
        
        const aStr = String(aValue);
        const bStr = String(bValue);
        
        if (filterState.sortDirection === 'asc') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      });
    }

    return result;
  }, [normalizedData, columns, filterState]);

  const handleGlobalSearchChange = (value: string) => {
    setFilterState(prev => ({
      ...prev,
      globalSearch: value
    }));
  };

  const handleColumnFilterChange = (columnIndex: number, value: string) => {
    setFilterState(prev => ({
      ...prev,
      columnFilters: {
        ...prev.columnFilters,
        [columnIndex]: value
      }
    }));
  };

  const handleSort = (columnName: string) => {
    setFilterState(prev => {
      if (prev.sortColumn === columnName) {
        // 切换排序方向
        if (prev.sortDirection === 'asc') {
          return {
            ...prev,
            sortDirection: 'desc'
          };
        } else if (prev.sortDirection === 'desc') {
          return {
            ...prev,
            sortColumn: null,
            sortDirection: null
          };
        } else {
          return {
            ...prev,
            sortDirection: 'asc'
          };
        }
      } else {
        // 新的排序列
        return {
          ...prev,
          sortColumn: columnName,
          sortDirection: 'asc'
        };
      }
    });
  };

  const clearFilters = () => {
    setFilterState({
      globalSearch: '',
      columnFilters: {},
      sortColumn: null,
      sortDirection: null
    });
  };

  if (!data || data.length === 0) {
    return (
      <div className="data-table empty">
        <div className="empty-state">
          <p>没有数据返回</p>
          <small>查询执行时间: {executionTime}ms</small>
        </div>
      </div>
    );
  }

  // 限制显示行数
  const displayRows = filteredAndSortedData.slice(0, 2000);
  const showLimitMessage = filteredAndSortedData.length > 2000;

  return (
    <div className="data-table-container">
      {/* 控制面板 */}
      <div className="table-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="全局搜索..."
            value={filterState.globalSearch}
            onChange={(e) => handleGlobalSearchChange(e.target.value)}
            className="global-search-input"
          />
        </div>
        
        <div className="controls-right">
          <button 
            onClick={clearFilters}
            className="clear-filters-btn"
            disabled={!filterState.globalSearch && Object.keys(filterState.columnFilters).length === 0 && !filterState.sortColumn}
          >
            清除筛选
          </button>
          
          <div className="table-info">
            <span>显示 {displayRows.length} 行 (共 {rowCount} 行)</span>
            <span>执行时间: {executionTime}ms</span>
          </div>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            {/* 列标题行 */}
            <tr>
              {columns.map((column, index) => (
                <th 
                  key={index}
                  onClick={() => handleSort(column)}
                  className={`sortable ${filterState.sortColumn === column ? `sorted-${filterState.sortDirection}` : ''}`}
                >
                  <div className="column-header">
                    <span>{column}</span>
                    <span className="sort-indicator">
                      {filterState.sortColumn === column && (
                        filterState.sortDirection === 'asc' ? '↑' : '↓'
                      )}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
            
            {/* 筛选行 */}
            <tr className="filter-row">
              {columns.map((column, index) => (
                <th key={index}>
                  <input
                    type="text"
                    placeholder={`筛选 ${column}...`}
                    value={filterState.columnFilters[index] || ''}
                    onChange={(e) => handleColumnFilterChange(index, e.target.value)}
                    className="column-filter-input"
                  />
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {cell === null ? (
                      <span className="null-value">NULL</span>
                    ) : typeof cell === 'object' ? (
                      <span className="object-value" title={JSON.stringify(cell)}>
                        {JSON.stringify(cell).substring(0, 50)}
                        {JSON.stringify(cell).length > 50 ? '...' : ''}
                      </span>
                    ) : (
                      <span className="cell-value">{String(cell)}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {showLimitMessage && (
        <div className="table-footer">
          <p>仅显示前2000行，实际共有 {filteredAndSortedData.length} 行</p>
        </div>
      )}
    </div>
  );
};