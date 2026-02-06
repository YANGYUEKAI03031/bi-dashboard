import React from 'react';
import './NodePalette.css';

interface NodeType {
  type: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

interface NodePaletteProps {
  onNodeAdd: (nodeType: string) => void;
}

const NODE_TYPES: NodeType[] = [
  {
    type: 'data_source',
    name: '数据源',
    icon: '🗄️',
    color: '#4CAF50',
    description: '连接数据库获取数据'
  },
  {
    type: 'processing',
    name: '数据处理',
    icon: '⚙️',
    color: '#2196F3',
    description: '对数据进行筛选、聚合、转换等处理'
  },
  {
    type: 'visualization',
    name: '数据可视化',
    icon: '📊',
    color: '#FF9800',
    description: '创建图表和报表'
  }
];

export const NodePalette: React.FC<NodePaletteProps> = ({ onNodeAdd }) => {
  const handleNodeDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType.type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="node-palette">
      <h3>节点库</h3>
      <div className="node-types">
        {NODE_TYPES.map((nodeType) => (
          <div
            key={nodeType.type}
            className="node-type-item"
            draggable
            onDragStart={(e) => handleNodeDragStart(e, nodeType)}
          >
            <div 
              className="node-icon" 
              style={{ backgroundColor: nodeType.color }}
            >
              {nodeType.icon}
            </div>
            <div className="node-info">
              <h4>{nodeType.name}</h4>
              <p>{nodeType.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};