// src/components/NodeConfigModal/NodeConfigModal.tsx

import React, { useState, useEffect } from 'react';
import './NodeConfigModal.css';

// 定义配置接口
interface NodeConfig {
  [key: string]: any;
}

// 定义节点接口（如果需要）
interface Node {
  id: string;
  type: string;
  config: NodeConfig;
  // 其他节点属性...
}

// 定义组件属性接口
interface NodeConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: NodeConfig; // 改为可选
  onSave: (config: NodeConfig) => void;
  // 可选：添加 node 属性
  node?: Node | null; // 修改为接受 null 值
}

const NodeConfigModal: React.FC<NodeConfigModalProps> = ({ 
  isOpen, 
  onClose, 
  config: externalConfig, // 重命名外部传入的config
  onSave,
  node // 接收 node 属性
}) => {
  // 优先使用 node.config，如果没有则使用外部传入的 config
  const initialConfig = node?.config || externalConfig || {};
  const [currentConfig, setCurrentConfig] = useState<NodeConfig>(initialConfig);

  // 当 node 或 externalConfig 变化时更新 currentConfig
  useEffect(() => {
    const newConfig = node?.config || externalConfig || {};
    setCurrentConfig(newConfig);
  }, [node, externalConfig]);

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    setCurrentConfig((prev: NodeConfig) => ({
      ...prev,
      [name]: value
    }));
  };

  // 处理保存操作
  const handleSave = () => {
    onSave(currentConfig);
    onClose();
  };

  // 处理取消操作
  const handleCancel = () => {
    onClose();
  };

  // 如果模态框未打开，返回 null
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>节点配置</h3>
          <button onClick={handleCancel} className="close-button">×</button>
        </div>
        
        <div className="modal-body">
          {/* 配置表单 */}
          <form>
            {/* 动态生成配置项 */}
            {Object.keys(currentConfig).map(key => (
              <div key={key} className="form-group">
                <label htmlFor={key}>{key}</label>
                <input
                  type="text"
                  id={key}
                  name={key}
                  value={currentConfig[key]}
                  onChange={handleChange}
                  className="config-input"
                />
              </div>
            ))}
          </form>
        </div>
        
        <div className="modal-footer">
          <button onClick={handleCancel} className="cancel-button">
            取消
          </button>
          <button onClick={handleSave} className="save-button">
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default NodeConfigModal;