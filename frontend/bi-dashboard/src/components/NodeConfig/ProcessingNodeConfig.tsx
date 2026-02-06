import React, { useState, useEffect } from 'react';
import './ProcessingNodeConfig.css';

// 添加详细的操作配置接口
interface FilterCondition {
  field: string;
  operator: string;
  value: string;
  logic: string;
}

interface FilterOperationConfig {
  conditions: FilterCondition[];
  joinLogic: string;
}

interface AggregationConfig {
  field: string;
  function: string;
  alias: string;
}

interface AggregateOperationConfig {
  groupBy: string[];
  aggregations: AggregationConfig[];
}

interface TransformOperationConfig {
  type: string;
  field: string;
  expression: string;
  newField: string;
}

interface ProcessingOperation {
  id: string;
  type: 'filter' | 'aggregate' | 'transform';
  config: FilterOperationConfig | AggregateOperationConfig | TransformOperationConfig;
}

interface ProcessingNodeConfigProps {
  config: any;
  onChange: (config: any) => void;
  inputData?: any;
}

const ProcessingNodeConfig: React.FC<ProcessingNodeConfigProps> = ({ 
  config, 
  onChange,
  inputData = null
}) => {
  const [operations, setOperations] = useState<ProcessingOperation[]>(config.operations || []);
  const [availableFields, setAvailableFields] = useState<string[]>([]);

  useEffect(() => {
    setOperations(config.operations || []);
    // 从输入数据中提取可用字段
    if (inputData?.columns) {
      setAvailableFields(inputData.columns);
    } else if (inputData?.data?.length > 0) {
      setAvailableFields(Object.keys(inputData.data[0]));
    }
  }, [config, inputData]);

  const addOperation = (operationType: ProcessingOperation['type']) => {
    const newOperation: ProcessingOperation = {
      id: `op_${Date.now()}`,
      type: operationType,
      config: getDefaultOperationConfig(operationType)
    };
    const updatedOperations = [...operations, newOperation];
    setOperations(updatedOperations);
    onChange({ ...config, operations: updatedOperations });
  };

  const removeOperation = (operationId: string) => {
    const updatedOperations = operations.filter(op => op.id !== operationId);
    setOperations(updatedOperations);
    onChange({ ...config, operations: updatedOperations });
  };

  const updateOperation = (operationId: string, newConfig: any) => {
    const updatedOperations = operations.map(op => 
      op.id === operationId ? { ...op, config: newConfig } : op
    );
    setOperations(updatedOperations);
    onChange({ ...config, operations: updatedOperations });
  };

  const getDefaultOperationConfig = (operationType: string): any => {
    switch (operationType) {
      case 'filter':
        return {
          conditions: [{ field: '', operator: '=', value: '', logic: 'AND' }],
          joinLogic: 'AND'
        };
      case 'aggregate':
        return {
          groupBy: [],
          aggregations: [{ field: '', function: 'COUNT', alias: '' }]
        };
      case 'transform':
        return {
          type: 'formula',
          field: '',
          expression: '',
          newField: ''
        };
      default:
        return {};
    }
  };

  const renderOperationConfig = (operation: ProcessingOperation) => {
    switch (operation.type) {
      case 'filter':
        return (
          <FilterOperationConfig 
            operation={operation} 
            onUpdate={updateOperation}
            availableFields={availableFields}
          />
        );
      case 'aggregate':
        return (
          <AggregateOperationConfig 
            operation={operation} 
            onUpdate={updateOperation}
            availableFields={availableFields}
          />
        );
      case 'transform':
        return (
          <TransformOperationConfig 
            operation={operation} 
            onUpdate={updateOperation}
            availableFields={availableFields}
          />
        );
      default:
        return <div>未知操作类型</div>;
    }
  };

  return (
    <div className="processing-node-config">
      <div className="config-section">
        <h3>数据处理配置</h3>
        
        <div className="input-source-section">
          <h4>输入数据源</h4>
          {inputData ? (
            <div className="input-info">
              <div className="input-stats">
                <span>行数: {inputData.total_rows || inputData.data?.length || 0}</span>
                <span>列数: {availableFields.length}</span>
              </div>
              {inputData.table_name && (
                <div className="input-table">来源表: {inputData.table_name}</div>
              )}
            </div>
          ) : (
            <div className="no-input-warning">
              ⚠️ 请先连接数据源节点
            </div>
          )}
        </div>

        <div className="operations-section">
          <div className="section-header">
            <h4>处理操作</h4>
            <div className="add-operation-buttons">
              <button
                className="add-operation-btn"
                onClick={() => addOperation('filter')}
              >
                <span className="btn-icon">🔍</span>
                <span className="btn-text">数据筛选</span>
              </button>
              <button
                className="add-operation-btn"
                onClick={() => addOperation('aggregate')}
              >
                <span className="btn-icon">📊</span>
                <span className="btn-text">数据聚合</span>
              </button>
              <button
                className="add-operation-btn"
                onClick={() => addOperation('transform')}
              >
                <span className="btn-icon">🔄</span>
                <span className="btn-text">数据转换</span>
              </button>
            </div>
          </div>

          <div className="operations-list">
            {operations.length === 0 ? (
              <div className="empty-operations">
                <p>还没有添加任何处理操作</p>
                <p>点击上方按钮添加第一个操作</p>
              </div>
            ) : (
              operations.map((operation, index) => (
                <div key={operation.id} className="operation-item">
                  <div className="operation-header">
                    <div className="operation-title">
                      <span className="operation-number">#{index + 1}</span>
                      <span className="operation-name">
                        {operation.type === 'filter' && '数据筛选'}
                        {operation.type === 'aggregate' && '数据聚合'}
                        {operation.type === 'transform' && '数据转换'}
                      </span>
                      <span className="operation-type">{operation.type}</span>
                    </div>
                    <div className="operation-actions">
                      <button 
                        className="remove-operation-btn"
                        onClick={() => removeOperation(operation.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="operation-config">
                    {renderOperationConfig(operation)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const FilterOperationConfig: React.FC<{
  operation: ProcessingOperation;
  onUpdate: (id: string, config: any) => void;
  availableFields: string[];
}> = ({ operation, onUpdate, availableFields }) => {
  const config = operation.config as FilterOperationConfig;
  
  const addCondition = () => {
    const newConditions = [...(config.conditions || []), 
      { field: '', operator: '=', value: '', logic: 'AND' }
    ];
    onUpdate(operation.id, { ...config, conditions: newConditions });
  };

  const updateCondition = (index: number, field: keyof FilterCondition, value: string) => {
    const newConditions = [...config.conditions];
    (newConditions[index] as any)[field] = value;
    onUpdate(operation.id, { ...config, conditions: newConditions });
  };

  const removeCondition = (index: number) => {
    const newConditions = config.conditions.filter((_, i) => i !== index);
    onUpdate(operation.id, { ...config, conditions: newConditions });
  };

  return (
    <div className="filter-operation-config">
      <div className="config-row">
        <label>连接逻辑:</label>
        <select 
          value={config.joinLogic || 'AND'}
          onChange={(e) => onUpdate(operation.id, { ...config, joinLogic: e.target.value })}
        >
          <option value="AND">AND (与)</option>
          <option value="OR">OR (或)</option>
        </select>
      </div>
      
      <div className="conditions-list">
        <h5>筛选条件:</h5>
        {(config.conditions || []).map((condition, index) => (
          <div key={index} className="condition-item">
            {index > 0 && (
              <select 
                value={condition.logic}
                onChange={(e) => updateCondition(index, 'logic', e.target.value)}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
            <select
              value={condition.field}
              onChange={(e) => updateCondition(index, 'field', e.target.value)}
            >
              <option value="">选择字段</option>
              {availableFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            <select
              value={condition.operator}
              onChange={(e) => updateCondition(index, 'operator', e.target.value)}
            >
              <option value="=">=</option>
              <option value="!=">!=</option>
              <option value=">">{">"}</option>
              <option value="<">{"<"}</option>
              <option value=">=">{">="}</option>
              <option value="<=">{"<="}</option>
              <option value="LIKE">包含</option>
              <option value="NOT LIKE">不包含</option>
            </select>
            <input
              type="text"
              placeholder="值"
              value={condition.value}
              onChange={(e) => updateCondition(index, 'value', e.target.value)}
            />
            {config.conditions.length > 1 && (
              <button onClick={() => removeCondition(index)}>
                删除
              </button>
            )}
          </div>
        ))}
        <button onClick={addCondition} className="add-condition-btn">
          + 添加条件
        </button>
      </div>
    </div>
  );
};

const AggregateOperationConfig: React.FC<{
  operation: ProcessingOperation;
  onUpdate: (id: string, config: any) => void;
  availableFields: string[];
}> = ({ operation, onUpdate, availableFields }) => {
  const config = operation.config as AggregateOperationConfig;

  const addAggregation = () => {
    const newAggregations = [...(config.aggregations || []), 
      { field: '', function: 'COUNT', alias: '' }
    ];
    onUpdate(operation.id, { ...config, aggregations: newAggregations });
  };

  const updateAggregation = (index: number, field: keyof AggregationConfig, value: string) => {
    const newAggregations = [...config.aggregations];
    (newAggregations[index] as any)[field] = value;
    onUpdate(operation.id, { ...config, aggregations: newAggregations });
  };

  const removeAggregation = (index: number) => {
    const newAggregations = config.aggregations.filter((_, i) => i !== index);
    onUpdate(operation.id, { ...config, aggregations: newAggregations });
  };

  const toggleGroupBy = (field: string) => {
    const newGroupBy = config.groupBy.includes(field)
      ? config.groupBy.filter(f => f !== field)
      : [...config.groupBy, field];
    onUpdate(operation.id, { ...config, groupBy: newGroupBy });
  };

  return (
    <div className="aggregate-operation-config">
      <div className="group-by-section">
        <h5>分组字段:</h5>
        <div className="field-checkboxes">
          {availableFields.map(field => (
            <label key={field} className="field-checkbox">
              <input
                type="checkbox"
                checked={config.groupBy.includes(field)}
                onChange={() => toggleGroupBy(field)}
              />
              {field}
            </label>
          ))}
        </div>
      </div>

      <div className="aggregations-list">
        <h5>聚合函数:</h5>
        {(config.aggregations || []).map((agg, index) => (
          <div key={index} className="aggregation-item">
            <select
              value={agg.field}
              onChange={(e) => updateAggregation(index, 'field', e.target.value)}
            >
              <option value="">选择字段</option>
              {availableFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            <select
              value={agg.function}
              onChange={(e) => updateAggregation(index, 'function', e.target.value)}
            >
              <option value="COUNT">计数(COUNT)</option>
              <option value="SUM">求和(SUM)</option>
              <option value="AVG">平均值(AVG)</option>
              <option value="MIN">最小值(MIN)</option>
              <option value="MAX">最大值(MAX)</option>
            </select>
            <input
              type="text"
              placeholder="别名(可选)"
              value={agg.alias}
              onChange={(e) => updateAggregation(index, 'alias', e.target.value)}
            />
            <button onClick={() => removeAggregation(index)}>删除</button>
          </div>
        ))}
        <button onClick={addAggregation} className="add-aggregation-btn">
          + 添加聚合
        </button>
      </div>
    </div>
  );
};

const TransformOperationConfig: React.FC<{
  operation: ProcessingOperation;
  onUpdate: (id: string, config: any) => void;
  availableFields: string[];
}> = ({ operation, onUpdate, availableFields }) => {
  const config = operation.config as TransformOperationConfig;

  return (
    <div className="transform-operation-config">
      <div className="config-row">
        <label>转换类型:</label>
        <select
          value={config.type}
          onChange={(e) => onUpdate(operation.id, { ...config, type: e.target.value })}
        >
          <option value="formula">公式计算</option>
          <option value="rename">重命名字段</option>
          <option value="cast">类型转换</option>
        </select>
      </div>

      {config.type === 'formula' && (
        <>
          <div className="config-row">
            <label>新字段名:</label>
            <input
              type="text"
              value={config.newField}
              onChange={(e) => onUpdate(operation.id, { ...config, newField: e.target.value })}
              placeholder="输入新字段名称"
            />
          </div>
          <div className="config-row">
            <label>计算公式:</label>
            <textarea
              value={config.expression}
              onChange={(e) => onUpdate(operation.id, { ...config, expression: e.target.value })}
              placeholder="例如: field1 + field2 * 2"
              rows={3}
            />
            <small>可用字段: {availableFields.join(', ')}</small>
          </div>
        </>
      )}

      {config.type === 'rename' && (
        <>
          <div className="config-row">
            <label>原字段:</label>
            <select
              value={config.field}
              onChange={(e) => onUpdate(operation.id, { ...config, field: e.target.value })}
            >
              <option value="">选择字段</option>
              {availableFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
          </div>
          <div className="config-row">
            <label>新字段名:</label>
            <input
              type="text"
              value={config.newField}
              onChange={(e) => onUpdate(operation.id, { ...config, newField: e.target.value })}
              placeholder="输入新字段名称"
            />
          </div>
        </>
      )}

      {config.type === 'cast' && (
        <>
          <div className="config-row">
            <label>目标字段:</label>
            <select
              value={config.field}
              onChange={(e) => onUpdate(operation.id, { ...config, field: e.target.value })}
            >
              <option value="">选择字段</option>
              {availableFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
          </div>
          <div className="config-row">
            <label>目标类型:</label>
            <select
              value={config.expression}
              onChange={(e) => onUpdate(operation.id, { ...config, expression: e.target.value })}
            >
              <option value="">选择类型</option>
              <option value="int">整数(Integer)</option>
              <option value="float">浮点数(Float)</option>
              <option value="str">字符串(String)</option>
              <option value="datetime">日期时间(DateTime)</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
};

export default ProcessingNodeConfig;