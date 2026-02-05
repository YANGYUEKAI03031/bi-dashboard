// frontend/bi-dashboard/src/components/NodePalette/NodePalette.tsx
import React from 'react';
import './NodePalette.css';

interface NodeType {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
}

// 只保留数据源节点
const NODE_TYPES: NodeType[] = [
  {
    id: 'data_source',
    name: '数据源',
    icon: '📊',
    description: '从数据库获取原始数据',
    color: '#667eea'
  }
];

interface NodePaletteProps {
  onNodeAdd?: (nodeType: string, position: { x: number; y: number }) => void;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onNodeAdd }) => {
  const handleDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData('nodeType', nodeType);
  };

  return (
    <div className="node-palette">
      <div className="palette-header">
        <h3>节点库</h3>
        <p>拖拽节点到画布中</p>
      </div>
      
      <div className="node-types">
        {NODE_TYPES.map((nodeType) => (
          <div
            key={nodeType.id}
            className="node-type-item"
            draggable
            onDragStart={(e) => handleDragStart(e, nodeType.id)}
          >
            <div 
              className="node-icon"
              style={{ backgroundColor: nodeType.color }}
            >
              {nodeType.icon}
            </div>
            <div className="node-info">
              <div className="node-name">{nodeType.name}</div>
              <div className="node-description">{nodeType.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};