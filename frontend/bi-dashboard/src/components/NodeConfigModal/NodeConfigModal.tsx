// frontend/bi-dashboard/src/components/NodeConfigModal/NodeConfigModal.tsx
import React, { useState, useEffect } from 'react';
import { DataNodeConfig, DataFilterConfig } from '../NodeConfig';
import './NodeConfigModal.css';

interface NodeConfig {
  id: string;
  type: string;
  name: string;
  description?: string;
  [key: string]: any;
}

interface NodeConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: NodeConfig | null;
  onSave: (config: NodeConfig) => void;
}

const NodeConfigModal: React.FC<NodeConfigModalProps> = ({ 
  isOpen, 
  onClose, 
  node, 
  onSave 
}) => {
  const [config, setConfig] = useState<NodeConfig>({ 
    id: '', 
    type: '', 
    name: '',
    description: ''
  });

  useEffect(() => {
    if (node) {
      setConfig({ ...node });
    }
  }, [node]);

  if (!isOpen || !node) return null;

  const handleSave = () => {
    // 确保保存时包含节点的 ID
    onSave({ ...config, id: node.id });
    onClose();
  };

  const handleConfigChange = (newConfig: any) => {
    setConfig({ ...config, ...newConfig });
  };

  const renderConfigForm = () => {
    switch (node.type) {
      case 'data_source':
        return (
          <DataNodeConfig 
            config={config}
            onChange={handleConfigChange}
          />
        );
      
      case 'data_filter':
        return (
          <DataFilterConfig 
            config={config}
            onChange={handleConfigChange}
            // 可以从外部传入可用的表列表
            availableTables={['pinjia', 'users', 'orders', 'products']}
          />
        );

      default:
        return (
          <div className="config-section">
            <h3>基础配置</h3>
            <div className="form-group">
              <label>节点名称:</label>
              <input
                type="text"
                value={config.name || ''}
                onChange={(e) => setConfig({...config, name: e.target.value})}
                placeholder="输入节点名称"
              />
            </div>
            <div className="form-group">
              <label>描述:</label>
              <textarea
                value={config.description || ''}
                onChange={(e) => setConfig({...config, description: e.target.value})}
                placeholder="节点功能描述"
                rows={3}
              />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="node-config-modal-overlay">
      <div className="node-config-modal-content">
        <div className="modal-header">
          <h2>配置节点 - {getNodeTypeDisplayName(node.type)}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="config-form">
            {renderConfigForm()}
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>
            取消
          </button>
          <button className="save-btn" onClick={handleSave}>
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
};

// 辅助函数
const getNodeTypeDisplayName = (nodeType: string): string => {
  const names: Record<string, string> = {
    'data_source': '数据源',
    'data_filter': '数据筛选',
    // 暂时注释掉其他节点类型
    // 'data_cleaning': '数据清洗',
    // 'feature_engineering': '特征工程',
    // 'statistical_analysis': '统计分析',
    // 'ml_prediction': '机器学习预测',
    // 'data_visualization': '数据可视化'
  };
  return names[nodeType] || nodeType;
};

export default NodeConfigModal;