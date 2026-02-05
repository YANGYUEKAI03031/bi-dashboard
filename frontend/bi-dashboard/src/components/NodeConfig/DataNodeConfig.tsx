// frontend/bi-dashboard/src/components/NodeConfig/DataNodeConfig.tsx
import React, { useState, useEffect } from 'react';
import './DataNodeConfig.css';

interface DataNodeConfigProps {
  config: any;
  onChange: (config: any) => void;
}

const DataNodeConfig: React.FC<DataNodeConfigProps> = ({ config, onChange }) => {
  const [localConfig, setLocalConfig] = useState({
    database: config.database || '',
    query: config.query || '',
    sampleSize: config.sampleSize || 1000,
    tableName: config.tableName || '',
    whereClause: config.whereClause || ''
  });

  useEffect(() => {
    setLocalConfig({
      database: config.database || '',
      query: config.query || '',
      sampleSize: config.sampleSize || 1000,
      tableName: config.tableName || '',
      whereClause: config.whereClause || ''
    });
  }, [config]);

  const handleChange = (field: string, value: any) => {
    const newConfig = { ...localConfig, [field]: value };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  return (
    <div className="data-node-config">
      <div className="config-section">
        <h3>数据源配置</h3>
        
        <div className="form-group">
          <label>数据库连接:</label>
          <select 
            value={localConfig.database}
            onChange={(e) => handleChange('database', e.target.value)}
          >
            <option value="">请选择数据库</option>
            <option value="mysql">MySQL</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="oracle">Oracle</option>
            <option value="sqlserver">SQL Server</option>
          </select>
        </div>

        <div className="form-group">
          <label>表名:</label>
          <input
            type="text"
            value={localConfig.tableName}
            onChange={(e) => handleChange('tableName', e.target.value)}
            placeholder="输入表名"
          />
        </div>

        <div className="form-group">
          <label>WHERE条件:</label>
          <input
            type="text"
            value={localConfig.whereClause}
            onChange={(e) => handleChange('whereClause', e.target.value)}
            placeholder="例如: status = 'active' AND created_date > '2023-01-01'"
          />
        </div>

        <div className="form-group">
          <label>自定义查询:</label>
          <textarea
            value={localConfig.query}
            onChange={(e) => handleChange('query', e.target.value)}
            placeholder="SELECT * FROM table_name WHERE conditions"
            rows={4}
          />
          <small className="help-text">如果填写了自定义查询，将覆盖表名和WHERE条件设置</small>
        </div>

        <div className="form-group">
          <label>数据采样数量:</label>
          <input
            type="number"
            min="1"
            max="100000"
            value={localConfig.sampleSize}
            onChange={(e) => handleChange('sampleSize', parseInt(e.target.value) || 1000)}
          />
          <small className="help-text">设置为0表示获取全部数据</small>
        </div>
      </div>
    </div>
  );
};

export default DataNodeConfig;