// frontend/bi-dashboard/src/components/NodeConfig/DataFilterConfig.tsx
import React, { useState, useEffect } from 'react';
import './DataFilterConfig.css';

interface FilterCondition {
  field: string;
  operator: string;
  value: string;
  logic: 'AND' | 'OR';
}

interface DataFilterConfigProps {
  config: any;
  onChange: (config: any) => void;
  // 添加可用的表列表作为props
  availableTables?: string[];
}

const DataFilterConfig: React.FC<DataFilterConfigProps> = ({ 
  config, 
  onChange,
  availableTables = ['pinjia', 'users', 'orders', 'products'] // 默认表列表
}) => {
  const [localConfig, setLocalConfig] = useState({
    tableName: config.tableName || '',
    conditions: config.conditions || [] as FilterCondition[],
    outputFields: config.outputFields || [],
    limit: config.limit || 1000
  });

  const operators = [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: '>', label: '大于' },
    { value: '<', label: '小于' },
    { value: '>=', label: '大于等于' },
    { value: '<=', label: '小于等于' },
    { value: 'LIKE', label: '包含' },
    { value: 'NOT LIKE', label: '不包含' },
    { value: 'IN', label: '在列表中' },
    { value: 'NOT IN', label: '不在列表中' },
    { value: 'IS NULL', label: '为空' },
    { value: 'IS NOT NULL', label: '不为空' }
  ];

  // 不同表的字段定义
  const tableFields: Record<string, string[]> = {
    'pinjia': ['id', 'user_id', 'product_id', 'rating', 'comment', 'created_at', 'updated_at'],
    'users': ['id', 'username', 'email', 'phone', 'created_at', 'status'],
    'orders': ['id', 'user_id', 'product_id', 'quantity', 'price', 'order_date', 'status'],
    'products': ['id', 'name', 'category', 'price', 'stock', 'created_at']
  };

  useEffect(() => {
    setLocalConfig({
      tableName: config.tableName || '',
      conditions: config.conditions || [],
      outputFields: config.outputFields || [],
      limit: config.limit || 1000
    });
  }, [config]);

  const handleChange = (field: string, value: any) => {
    const newConfig = { ...localConfig, [field]: value };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const addCondition = () => {
    const newConditions = [...localConfig.conditions, {
      field: '',
      operator: '=',
      value: '',
      logic: 'AND'
    }];
    handleChange('conditions', newConditions);
  };

  const updateCondition = (index: number, field: keyof FilterCondition, value: any) => {
    const newConditions = [...localConfig.conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    handleChange('conditions', newConditions);
  };

  const removeCondition = (index: number) => {
    const newConditions = localConfig.conditions.filter((_: FilterCondition, i: number) => i !== index);
    handleChange('conditions', newConditions);
  };

  const addOutputField = () => {
    const newFields = [...localConfig.outputFields, ''];
    handleChange('outputFields', newFields);
  };

  const updateOutputField = (index: number, value: string) => {
    const newFields = [...localConfig.outputFields];
    newFields[index] = value;
    handleChange('outputFields', newFields);
  };

  const removeOutputField = (index: number) => {
    const newFields = localConfig.outputFields.filter((_: string, i: number) => i !== index);
    handleChange('outputFields', newFields);
  };

  // 获取当前表的可用字段
  const getCurrentTableFields = () => {
    return localConfig.tableName ? tableFields[localConfig.tableName] || [] : [];
  };

  return (
    <div className="data-filter-config">
      <div className="config-section">
        <h3>数据筛选配置</h3>
        
        <div className="form-group">
          <label>选择数据表:</label>
          <select 
            value={localConfig.tableName}
            onChange={(e) => handleChange('tableName', e.target.value)}
          >
            <option value="">请选择数据表</option>
            {availableTables.map((table: string) => (
              <option key={table} value={table}>{table}</option>
            ))}
          </select>
        </div>

        {localConfig.tableName && (
          <>
            <div className="form-group">
              <label>输出字段:</label>
              <div className="fields-container">
                {localConfig.outputFields.map((field: string, index: number) => (
                  <div key={index} className="field-item">
                    <select
                      value={field}
                      onChange={(e) => updateOutputField(index, e.target.value)}
                    >
                      <option value="">请选择字段</option>
                      {getCurrentTableFields().map((fieldName: string) => (
                        <option key={fieldName} value={fieldName}>{fieldName}</option>
                      ))}
                    </select>
                    <button 
                      type="button" 
                      className="remove-btn"
                      onClick={() => removeOutputField(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button 
                  type="button" 
                  className="add-btn"
                  onClick={addOutputField}
                >
                  + 添加字段
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>筛选条件:</label>
              <div className="conditions-container">
                {localConfig.conditions.map((condition: FilterCondition, index: number) => (
                  <div key={index} className="condition-item">
                    {index > 0 && (
                      <select
                        value={condition.logic}
                        onChange={(e) => updateCondition(index, 'logic', e.target.value)}
                        className="logic-select"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select
                      value={condition.field}
                      onChange={(e) => updateCondition(index, 'field', e.target.value)}
                      className="field-select"
                    >
                      <option value="">选择字段</option>
                      {getCurrentTableFields().map((fieldName: string) => (
                        <option key={fieldName} value={fieldName}>{fieldName}</option>
                      ))}
                    </select>
                    <select
                      value={condition.operator}
                      onChange={(e) => updateCondition(index, 'operator', e.target.value)}
                      className="operator-select"
                    >
                      {operators.map((op: {value: string, label: string}) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                    {condition.operator !== 'IS NULL' && condition.operator !== 'IS NOT NULL' && (
                      <input
                        type="text"
                        value={condition.value}
                        onChange={(e) => updateCondition(index, 'value', e.target.value)}
                        placeholder="值"
                        className="value-input"
                      />
                    )}
                    <button 
                      type="button" 
                      className="remove-btn"
                      onClick={() => removeCondition(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button 
                  type="button" 
                  className="add-btn"
                  onClick={addCondition}
                >
                  + 添加条件
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>结果限制:</label>
              <input
                type="number"
                min="1"
                max="100000"
                value={localConfig.limit}
                onChange={(e) => handleChange('limit', parseInt(e.target.value) || 1000)}
              />
              <small className="help-text">设置返回结果的最大行数，0表示不限制</small>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DataFilterConfig;