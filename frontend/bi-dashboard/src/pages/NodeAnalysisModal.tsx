// File: e:\bi-dashboard\frontend\bi-dashboard\src\pages\NodeAnalysisModal.tsx

import React, { useState } from 'react';
import { NodeCanvas } from '../components/NodeCanvas/NodeCanvas';
import { NodePalette } from '../components/NodePalette/NodePalette';
import './NodeAnalysisModal.css';

interface NodeAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTable: string | null;
}

const NodeAnalysisModal: React.FC<NodeAnalysisModalProps> = ({ 
  isOpen, 
  onClose, 
  selectedTable 
}) => {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // 节点数据分析功能
  const startNodeBasedAnalysis = (nodeId: string) => {
    console.log('开始节点分析:', nodeId);
    // 这里可以实现具体的节点分析逻辑
  };

  // 节点选择处理
  const handleNodeSelect = (nodeId: string) => {
    setSelectedNode(nodeId);
    console.log('选中节点:', nodeId);
  };

  // 节点配置处理
  const handleNodeConfigure = (nodeId: string) => {
    console.log('配置节点:', nodeId);
    // 这里可以打开节点配置对话框
  };

  if (!isOpen) return null;

  return (
    <div className="node-analysis-modal-overlay">
      <div className="node-analysis-modal-content">
        <div className="modal-header">
          <h2>节点式分析 - {selectedTable}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {/* 使用现有的NodePalette组件 */}
          <NodePalette 
            onNodeAdd={(nodeType: string) => {
              console.log('添加节点:', nodeType);
              // 注意：NodePalette 的 onNodeAdd 回调只接受 nodeType 参数
              // 如果需要位置信息，需要通过其他方式获取
            }}
          />
          
          {/* 使用现有的NodeCanvas组件 */}
          <div className="canvas-container">
            <NodeCanvas 
              onNodeSelect={handleNodeSelect}
              onNodeConfigure={handleNodeConfigure}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <div className="footer-info">
            当前选中节点: {selectedNode || '无'}
          </div>
          <div className="footer-actions">
            <button 
              className="analyze-btn"
              onClick={() => selectedNode && startNodeBasedAnalysis(selectedNode)}
              disabled={!selectedNode}
            >
              分析选中节点
            </button>
            <button className="execute-btn" onClick={() => console.log('执行工作流')}>
              执行工作流
            </button>
            <button className="save-btn" onClick={() => console.log('保存工作流')}>
              保存工作流
            </button>
            <button className="cancel-btn" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodeAnalysisModal;