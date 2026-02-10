/* 文件路径: e:\bi-dashboard\frontend\bi-dashboard\src\components\AdvancedDataAnalyzer\ExcelStyleDataTable.tsx */
import React, { useState } from 'react';
import './ExcelStyleDataTable.css';

interface ExcelStyleDataTableProps {
  data: any[][];
  columns: string[];
  rowCount?: number;
  executionTime?: number;
}

interface SortConfig {
  key: number;
  direction: 'asc' | 'desc';
}

export const ExcelStyleDataTable: React.FC<ExcelStyleDataTableProps> = ({ 
  data, 
  columns, 
  rowCount = data.length,
  executionTime = 0 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCell, setSelectedCell] = useState<{row: number, col: number} | null>(null);

  // 计算总页数
  const totalPages = Math.ceil(data.length / pageSize);

  // 处理搜索
  const filteredData = data.filter(row => {
    if (!Array.isArray(row)) return false;
    return row.some(cell => {
      if (cell === null || cell === undefined) return false;
      return cell.toString().toLowerCase().includes(searchTerm.toLowerCase());
    });
  });

  // 处理筛选
  const applyFilters = (dataArray: any[][]) => {
    return dataArray.map(row => {
      if (!Array.isArray(row)) return row;
      
      return row.map((cell, index) => {
        const columnKey = columns[index];
        const filterValue = filters[columnKey];
        
        if (filterValue && cell !== null && cell !== undefined) {
          if (!cell.toString().toLowerCase().includes(filterValue.toLowerCase())) {
            return null; // 标记为过滤掉
          }
        }
        return cell;
      });
    }).filter(row => {
      if (!Array.isArray(row)) return false;
      return row.some(cell => cell !== null);
    });
  };

  const filteredAndSortedData = applyFilters(filteredData);

  // 排序
  const sortedData = sortConfig 
    ? [...filteredAndSortedData].sort((a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b)) return 0;
        
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        
        const aStr = aValue.toString();
        const bStr = bValue.toString();
        
        if (sortConfig.direction === 'asc') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      })
    : filteredAndSortedData;

  // 分页
  const paginatedData = sortedData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // 处理排序
  const handleSort = (columnIndex: number) => {
    let direction: 'asc' | 'desc' = 'asc';
    
    if (sortConfig && sortConfig.key === columnIndex) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    
    setSortConfig({ key: columnIndex, direction });
  };

  // 处理筛选
  const handleFilterChange = (columnIndex: number, value: string) => {
    const columnKey = columns[columnIndex];
    setFilters(prev => ({
      ...prev,
      [columnKey]: value
    }));
  };

  // 清除筛选
  const clearAllFilters = () => {
    setFilters({});
  };

  // 处理单元格选择
  const handleCellSelect = (rowIndex: number, colIndex: number) => {
    setSelectedCell({ row: rowIndex, col: colIndex });
  };

  // 渲染列头
  const renderColumnHeader = (columnIndex: number) => {
    const columnKey = columns[columnIndex];
    const isFiltered = !!filters[columnKey];
    const isSorted = sortConfig?.key === columnIndex;
    
    return (
      <th 
        key={columnIndex}
        className={`excel-header ${isFiltered ? 'filtered' : ''} ${isSorted ? 'sorted' : ''}`}
        onClick={() => handleSort(columnIndex)}
      >
        <div className="header-content">
          <span className="column-name">{columnKey}</span>
          {isFiltered && <span className="filter-icon">🔍</span>}
          {isSorted && (
            <span className={`sort-icon ${sortConfig?.direction}`}>
              {sortConfig?.direction === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </div>
      </th>
    );
  };

  // 渲染筛选行
  const renderFilterRow = () => {
    return (
      <tr className="filter-row">
        {columns.map((_, columnIndex) => {
          const columnKey = columns[columnIndex];
          const filterValue = filters[columnKey] || '';
          
          return (
            <td key={columnIndex} className="filter-cell">
              <input
                type="text"
                placeholder={`筛选...`}
                value={filterValue}
                onChange={(e) => handleFilterChange(columnIndex, e.target.value)}
                className="filter-input"
              />
              {filterValue && (
                <button
                  onClick={() => handleFilterChange(columnIndex, '')}
                  className="clear-filter-btn"
                >
                  ×
                </button>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  // 渲染数据行
  const renderDataRow = (rowIndex: number, originalRowIndex: number) => {
    const row = paginatedData[rowIndex];
    
    if (!Array.isArray(row)) {
      return (
        <tr key={rowIndex} className="data-row">
          <td colSpan={columns.length} className="error-cell">
            数据格式错误
          </td>
        </tr>
      );
    }
    
    return (
      <tr 
        key={rowIndex} 
        className={`data-row ${selectedCell?.row === originalRowIndex ? 'selected-row' : ''}`}
      >
        {row.map((cell, columnIndex) => {
          const isSelected = selectedCell?.row === originalRowIndex && selectedCell?.col === columnIndex;
          
          return (
            <td 
              key={columnIndex}
              className={`data-cell ${isSelected ? 'selected' : ''}`}
              onClick={() => handleCellSelect(originalRowIndex, columnIndex)}
            >
              <div className="cell-content">
                {cell === null || cell === undefined ? '' : String(cell)}
              </div>
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="excel-datatable-container">
      {/* 工具栏 */}
      <div className="excel-toolbar">
        <div className="toolbar-left">
          <div className="stats-info">
            <span className="stat-item">
              <span className="stat-label">行数:</span>
              <span className="stat-value">{rowCount.toLocaleString()}</span>
            </span>
            <span className="stat-item">
              <span className="stat-label">显示:</span>
              <span className="stat-value">{paginatedData.length} 行</span>
            </span>
          </div>
          
          <div className="search-box">
            <input
              type="text"
              placeholder="🔍 搜索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        
        <div className="toolbar-right">
          <button 
            className="clear-btn"
            onClick={clearAllFilters}
          >
            清除筛选
          </button>
          
          <div className="page-size-selector">
            <label>每页:</label>
            <select 
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>
      </div>

      {/* 表格容器 */}
      <div className="excel-table-wrapper">
        <table className="excel-datatable">
          <thead>
            <tr>
              {columns.map((_, columnIndex) => renderColumnHeader(columnIndex))}
            </tr>
            {renderFilterRow()}
          </thead>
          
          <tbody>
            {paginatedData.map((_, rowIndex) => {
              const originalRowIndex = (currentPage - 1) * pageSize + rowIndex;
              return renderDataRow(rowIndex, originalRowIndex);
            })}
            
            {paginatedData.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="no-data-cell">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 状态栏 */}
      <div className="excel-status-bar">
        <div className="status-left">
          <span className="status-text">
            显示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, data.length)} 行，
            共 {data.length} 行
          </span>
          {executionTime > 0 && (
            <span className="execution-time">
              执行时间: {executionTime}ms
            </span>
          )}
        </div>
        
        {/* 分页控件 */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              ◀
            </button>
            
            <span className="page-info">
              {currentPage} / {totalPages}
            </span>
            
            <button
              className="page-btn"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
};