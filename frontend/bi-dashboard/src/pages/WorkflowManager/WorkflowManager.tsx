// File: e:\bi-dashboard\frontend\bi-dashboard\src\pages\WorkflowManager\WorkflowManager.tsx

import React, { useState, useEffect } from 'react';
import './WorkflowManager.css';

export const WorkflowManager: React.FC = () => {
  // 移除不再使用的状态，因为 NodeCanvas 组件内部管理自己的状态
  // const [nodes, setNodes] = useState<any[]>([]);
  // const [edges, setEdges] = useState<any[]>([]);

  const handleNodeAdd = (nodeType: string) => {
    // 这个函数现在只是用来处理 NodePalette 的回调
    // 实际的节点添加由 NodeCanvas 组件内部处理
    console.log('Adding node of type:', nodeType);
  };

  return (
    <div className="workflow-manager">
      
    </div>
  );
};