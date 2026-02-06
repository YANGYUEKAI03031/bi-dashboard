import React, { useState, useEffect, useRef } from 'react';
import './DataNodeConfig.css';

interface DataRow {
  [key: string]: any;
}

interface DataNodeConfigState {
  tableName: string;
  selectedData: any;
  dataPreview: DataRow[];
}

interface DataNodeConfigProps {
  config: any;
  onChange: (config: any) => void;
  availableTables?: string[];
  onDataPreview?: (tableName: string) => void;
}

// 自定义搜索下拉框组件
const SearchableDropdown: React.FC<{
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
}> = ({ options, value, onChange, placeholder = "请选择...", loading = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 筛选选项
  const filteredOptions = options.filter(option => 
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (option: string) => {
    onChange(option);
    setSearchTerm(option);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    setIsOpen(true);
    
    // 如果输入为空，清空选择
    if (newValue === '') {
      onChange('');
    }
  };

  return (
    <div className="searchable-dropdown" ref={dropdownRef}>
      <div className="dropdown-input-container">
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="dropdown-input"
        />
        <span className="dropdown-arrow" onClick={() => setIsOpen(!isOpen)}>
          <svg viewBox="0  0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" fill="currentColor"/>
          </svg>
        </span>
      </div>
      
      {isOpen && (
        <div className="dropdown-options">
          {loading ? (
            <div className="dropdown-option disabled">加载中...</div>
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <div
                key={option}
                className={`dropdown-option ${value === option ? 'selected' : ''}`}
                onClick={() => handleSelect(option)}
              >
                {option}
              </div>
            ))
          ) : (
            <div className="dropdown-option disabled">未找到匹配的表</div>
          )}
        </div>
      )}
    </div>
  );
};

const DataNodeConfig: React.FC<DataNodeConfigProps> = ({ 
  config, 
  onChange,
  availableTables = [],
  onDataPreview 
}) => {
  const [localConfig, setLocalConfig] = useState<DataNodeConfigState>({
    tableName: config.tableName || '',
    selectedData: config.selectedData || null,
    dataPreview: config.dataPreview || [] as DataRow[]
  });
  
  const [tables, setTables] = useState<string[]>(availableTables);
  const [loading, setLoading] = useState(false);
  
  // 使用 useRef 来跟踪是否已经获取过数据
  const hasFetchedTablesRef = useRef(false);

  const fetchTableList = async () => {
    try {
      setLoading(true);
      
      // 使用 AbortController 实现请求取消
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
      
      const response = await fetch('http://localhost:8000/api/v1/data/tables', {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const tableNames = data.tables
        .filter((table: any) => !['useraccount', 'node_executions', 'workflows'].includes(table.name))
        .map((table: any) => table.name);
        
      setTables(tableNames);
      hasFetchedTablesRef.current = true;
    } catch (error) {
      // 类型检查：确保 error 是 Error 对象后再访问 name 属性
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('获取表列表失败:', error);
        alert('获取表列表失败，请检查网络连接或联系管理员');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 只有当 availableTables 为空且尚未获取过数据时才发起请求
    if (availableTables.length === 0 && !hasFetchedTablesRef.current) {
      fetchTableList();
    } else if (availableTables.length > 0) {
      setTables(availableTables);
    }
  }, [availableTables]);

  const handleTableSelect = async (tableName: string) => {
    setLocalConfig({
      ...localConfig,
      tableName: tableName
    });
    
    try {
      const response = await fetch(`http://localhost:8000/api/v1/data/table/${tableName}/preview`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      const newConfig = {
        tableName: tableName,
        selectedData: data,
        dataPreview: data.rows || []
      };
      
      setLocalConfig(newConfig);
      onChange(newConfig);
      
      if (onDataPreview) {
        onDataPreview(tableName);
      }
    } catch (error) {
      console.error('获取表数据失败:', error);
      alert('获取表数据失败，请检查网络连接或联系管理员');
    }
  };

  return (
    <div className="data-node-config">
      <div className="config-section">
        <h3>数据源配置</h3>
        
        <div className="form-group">
          <label>选择数据表:</label>
          <SearchableDropdown
            options={tables}
            value={localConfig.tableName}
            onChange={handleTableSelect}
            placeholder="搜索并选择数据表..."
            loading={loading}
          />
        </div>

        {localConfig.tableName && (
          <div className="data-preview-section">
            <h4>数据预览</h4>
            {localConfig.dataPreview.length > 0 ? (
              <div className="data-preview-table">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(localConfig.dataPreview[0]).map((key: string) => (
                        <th key={key}>{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {localConfig.dataPreview.slice(0, 3).map((row: DataRow, index: number) => (
                      <tr key={index}>
                        {Object.values(row).map((value: any, i: number) => (
                          <td key={i}>{String(value)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="preview-info">
                  显示前3行数据，共{localConfig.selectedData?.total_rows || 0}行
                </div>
              </div>
            ) : (
              <div className="no-data-preview">
                该表暂无数据
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataNodeConfig;