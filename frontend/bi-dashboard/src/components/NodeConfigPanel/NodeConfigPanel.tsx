// frontend/src/components/NodeConfigPanel/NodeConfigPanel.tsx
import React, { useState } from 'react';

interface NodeConfigPanelProps {
  node: any;
  onUpdate: (node: any) => void;
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ node, onUpdate }) => {
  const [config, setConfig] = useState(node.config);

  const handleConfigChange = (key: string, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    onUpdate({ ...node, config: newConfig });
  };

  const renderConfigForm = () => {
    switch (node.type) {
      case 'data_source':
        return (
          <div>
            <label>选择数据表:</label>
            <select 
              value={config.tableName || ''}
              onChange={(e) => handleConfigChange('tableName', e.target.value)}
            >
              <option value="">请选择...</option>
              <option value="pinjia">评价数据表</option>
              <option value="sales">销售数据表</option>
            </select>
          </div>
        );
      
      case 'data_cleaning':
        return (
          <div>
            <label>清洗规则:</label>
            <textarea
              value={JSON.stringify(config.rules || {}, null, 2)}
              onChange={(e) => handleConfigChange('rules', JSON.parse(e.target.value))}
            />
          </div>
        );
      
      case 'data_visualization':
        return (
          <div>
            <label>图表类型:</label>
            <select
              value={config.chartType || ''}
              onChange={(e) => handleConfigChange('chartType', e.target.value)}
            >
              <option value="bar">柱状图</option>
              <option value="line">折线图</option>
              <option value="pie">饼图</option>
            </select>
          </div>
        );
      
      default:
        return <div>通用配置面板</div>;
    }
  };

  return (
    <div className="node-config-panel">
      <h3>{node.name} 配置</h3>
      {renderConfigForm()}
      <button onClick={() => onUpdate(node)}>保存配置</button>
    </div>
  );
};