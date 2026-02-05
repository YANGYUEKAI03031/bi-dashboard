// frontend/bi-dashboard/src/components/NodeCanvas/NodeCanvas.tsx
import React, { useState, useRef, useEffect } from 'react';
import NodeConfigModal from '../NodeConfigModal/NodeConfigModal';
import './NodeCanvas.css';

interface Node {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config: any;
}

interface Connection {
  id: string;
  source: string;
  target: string;
}

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string | null;
  connectionId: string | null;
}

interface NodeCanvasProps {
  onNodeSelect?: (nodeId: string) => void;
  onNodeConfigure?: (nodeId: string) => void;
}

export const NodeCanvas: React.FC<NodeCanvasProps> = ({ onNodeSelect, onNodeConfigure }) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configuringNode, setConfiguringNode] = useState<Node | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>({ 
    x: 0, 
    y: 0, 
    nodeId: null,
    connectionId: null
  });
  const [connectingNode, setConnectingNode] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // 处理从调色板拖拽添加节点
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('nodeType');
    
    if (nodeType && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      addNode(nodeType, { x, y });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const addNode = (nodeType: string, position: { x: number; y: number }) => {
    const newNode: Node = {
      id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: nodeType,
      name: `${getNodeTypeDisplayName(nodeType)}_${nodes.length + 1}`,
      x: position.x,
      y: position.y,
      config: getDefaultConfig(nodeType)
    };
    setNodes(prev => [...prev, newNode]);
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (!canvasRef.current) return;
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    // 右键点击显示菜单
    if (e.button === 2) {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId: nodeId,
        connectionId: null
      });
      setSelectedNode(nodeId);
      return;
    }
    
    // 左键点击处理（仅用于拖拽）
    const rect = canvasRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - node.x;
    const offsetY = e.clientY - rect.top - node.y;
    
    setDraggingNode(nodeId);
    setDragOffset({ x: offsetX, y: offsetY });
    setSelectedNode(nodeId);
    onNodeSelect?.(nodeId);
    
    // 隐藏右键菜单
    setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingNode && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset.x;
      const y = e.clientY - rect.top - dragOffset.y;
      
      setNodes(nodes.map(node => 
        node.id === draggingNode 
          ? { ...node, x, y }
          : node
      ));
    }
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
  };

  // 连接节点功能
  const startConnection = (nodeId: string) => {
    setConnectingNode(nodeId);
  };

  const completeConnection = (targetNodeId: string) => {
    if (connectingNode && connectingNode !== targetNodeId) {
      const newConnection: Connection = {
        id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: connectingNode,
        target: targetNodeId
      };
      setConnections(prev => [...prev, newConnection]);
    }
    setConnectingNode(null);
  };

  // 节点配置功能（改为双击触发）
  const handleNodeDoubleClick = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      setConfiguringNode(node);
      setConfigModalOpen(true);
    }
  };

  // 删除功能
  const deleteNode = (nodeId: string) => {
    // 删除节点
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    
    // 删除相关的连接
    setConnections(prev => prev.filter(
      conn => conn.source !== nodeId && conn.target !== nodeId
    ));
    
    // 清除选中状态
    if (selectedNode === nodeId) {
      setSelectedNode(null);
    }
    
    // 如果正在连接此节点，取消连接状态
    if (connectingNode === nodeId) {
      setConnectingNode(null);
    }
    
    // 隐藏菜单
    setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
  };

  const deleteConnection = (connectionId: string) => {
    setConnections(prev => prev.filter(conn => conn.id !== connectionId));
    setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
  };

  // 右键菜单处理 - 只在点击空白处时隐藏
  const handleCanvasClick = (e: React.MouseEvent) => {
    // 只有点击到画布背景才隐藏菜单
    if (e.target === canvasRef.current) {
      setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
    }
  };

  const handleConfigSave = (config: any) => {
    setNodes(prev => prev.map(node => 
      node.id === config.id 
        ? { ...node, ...config }
        : node
    ));
  };

  const handleCloseConfig = () => {
    setConfigModalOpen(false);
    setConfiguringNode(null);
  };

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete键删除选中节点
      if (e.key === 'Delete' && selectedNode) {
        deleteNode(selectedNode);
      }
      // Esc键取消连接状态和隐藏菜单
      if (e.key === 'Escape') {
        setConnectingNode(null);
        setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedNode, connectingNode]);

  // 连接线点击处理
  const handleConnectionClick = (e: React.MouseEvent, connectionId: string) => {
    e.stopPropagation();
    // 右键点击连接线显示菜单
    if (e.button === 2) {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId: null,
        connectionId: connectionId
      });
    }
  };

  return (
    <>
      <div 
        ref={canvasRef}
        className="node-canvas"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 连接线 */}
        <svg className="connections-svg">
          {connections.map(conn => {
            const sourceNode = nodes.find(n => n.id === conn.source);
            const targetNode = nodes.find(n => n.id === conn.target);
            
            if (!sourceNode || !targetNode) return null;
            
            return (
              <g key={conn.id}>
                <line
                  x1={sourceNode.x + 25}
                  y1={sourceNode.y + 25}
                  x2={targetNode.x + 25}
                  y2={targetNode.y + 25}
                  stroke="#667eea"
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      nodeId: null,
                      connectionId: conn.id
                    });
                  }}
                  onClick={(e) => handleConnectionClick(e, conn.id)}
                  style={{ cursor: 'pointer' }}
                />
                {/* 连接线删除按钮 */}
                <circle
                  cx={(sourceNode.x + targetNode.x + 50) / 2}
                  cy={(sourceNode.y + targetNode.y + 50) / 2}
                  r="10"
                  fill="#ff4757"
                  stroke="white"
                  strokeWidth="2"
                  className="delete-connection-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConnection(conn.id);
                  }}
                  style={{ cursor: 'pointer' }}
                />
                <text
                  x={(sourceNode.x + targetNode.x + 50) / 2}
                  y={(sourceNode.y + targetNode.y + 50) / 2 + 4}
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  ×
                </text>
              </g>
            );
          })}
          
          {/* 临时连接线 */}
          {connectingNode && (
            <line
              x1={nodes.find(n => n.id === connectingNode)?.x! + 25 || 0}
              y1={nodes.find(n => n.id === connectingNode)?.y! + 25 || 0}
              x2={0}
              y2={0}
              stroke="#ff6b6b"
              strokeWidth="2"
              strokeDasharray="5,5"
              markerEnd="url(#arrowhead-temp)"
            />
          )}
        </svg>
        
        {/* 节点 */}
        {nodes.map(node => (
          <div
            key={node.id}
            className={`canvas-node ${selectedNode === node.id ? 'selected' : ''} ${connectingNode === node.id ? 'connecting' : ''}`}
            style={{
              left: node.x,
              top: node.y
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onDoubleClick={() => handleNodeDoubleClick(node.id)}
            // 移除了onClick事件，避免移动时触发配置
          >
            <div className="node-content">
              {getNodeIcon(node.type)}
            </div>
          </div>
        ))}
        
        {/* 节点标签 */}
        {nodes.map(node => (
          <div
            key={`label_${node.id}`}
            className="node-label"
            style={{
              left: node.x + 60,
              top: node.y + 10
            }}
          >
            {node.name}
          </div>
        ))}
        
        {/* 箭头定义 */}
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#667eea" />
            </marker>
            <marker
              id="arrowhead-temp"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#ff6b6b" />
            </marker>
          </defs>
        </svg>
        
        {/* 操作提示 */}
        {connectingNode && (
          <div className="connection-hint">
            点击目标节点完成连接 (按ESC取消)
          </div>
        )}
        
        {/* 右键菜单 */}
        {contextMenu.nodeId && (
          <div 
            className="context-menu"
            style={{ 
              left: contextMenu.x, 
              top: contextMenu.y 
            }}
          >
            <div 
              className="menu-item"
              onClick={() => {
                handleNodeDoubleClick(contextMenu.nodeId!);
                setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
              }}
            >
              🛠️ 配置节点
            </div>
            <div 
              className="menu-item"
              onClick={() => {
                startConnection(contextMenu.nodeId!);
                setContextMenu({ x: 0, y: 0, nodeId: null, connectionId: null });
              }}
            >
              🔗 创建连接
            </div>
            <div className="menu-divider"></div>
            <div 
              className="menu-item delete-item"
              onClick={() => deleteNode(contextMenu.nodeId!)}
            >
              🗑️ 删除节点
            </div>
          </div>
        )}
        
        {/* 连接线右键菜单 */}
        {contextMenu.connectionId && (
          <div 
            className="context-menu"
            style={{ 
              left: contextMenu.x, 
              top: contextMenu.y 
            }}
          >
            <div 
              className="menu-item delete-item"
              onClick={() => deleteConnection(contextMenu.connectionId!)}
            >
              🗑️ 删除连接
            </div>
          </div>
        )}
      </div>

      {/* 节点配置模态框 */}
      <NodeConfigModal
        isOpen={configModalOpen}
        onClose={handleCloseConfig}
        node={configuringNode}
        onSave={handleConfigSave}
      />
    </>
  );
};

// 辅助函数 - 只保留数据源相关映射
const getNodeTypeDisplayName = (nodeType: string): string => {
  const names: Record<string, string> = {
    'data_source': '数据源'
    // 删除其他节点类型的映射
  };
  return names[nodeType] || nodeType;
};

const getNodeIcon = (nodeType: string): string => {
  const icons: Record<string, string> = {
    'data_source': '📊'
    // 删除其他节点类型的图标映射
  };
  return icons[nodeType] || '⭕';
};

const getDefaultConfig = (nodeType: string): any => {
  const configs: Record<string, any> = {
    'data_source': {
      database: '',
      query: '',
      sampleSize: 1000,
      tableName: '',
      whereClause: ''
    }
    // 删除其他节点类型的配置
  };
  return configs[nodeType] || {};
};