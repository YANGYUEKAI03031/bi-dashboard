// frontend/bi-dashboard/src/pages/WorkflowManager/WorkflowManager.tsx
import React, { useState, useEffect } from 'react';
import { NodeCanvas } from '../../components/NodeCanvas/NodeCanvas';
import { NodePalette } from '../../components/NodePalette/NodePalette';
import './WorkflowManager.css';

export const WorkflowManager: React.FC = () => {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      const response = await fetch('/api/v1/analytics/workflows');
      const data = await response.json();
      setWorkflows(data.workflows);
    } catch (error) {
      console.error('加载工作流失败:', error);
    }
  };

  const saveWorkflow = async () => {
    // 保存当前工作流逻辑
    console.log('保存工作流');
  };

  const executeWorkflow = async () => {
    if (currentWorkflow) {
      try {
        const response = await fetch('/api/v1/analytics/workflows/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow_id: currentWorkflow.id })
        });
        const result = await response.json();
        console.log('执行结果:', result);
      } catch (error) {
        console.error('执行工作流失败:', error);
      }
    }
  };

  const loadWorkflow = async (workflowId: string) => {
    // 加载指定工作流
    console.log('加载工作流:', workflowId);
  };

  return (
    <div className="workflow-manager">
      <div className="toolbar">
        <div className="toolbar-left">
          <button className="btn-primary" onClick={saveWorkflow}>
            保存工作流
          </button>
          <button className="btn-secondary" onClick={executeWorkflow}>
            执行工作流
          </button>
        </div>
        
        <div className="toolbar-right">
          <select onChange={(e) => loadWorkflow(e.target.value)}>
            <option value="">选择工作流</option>
            {workflows.map(wf => (
              <option key={wf.id} value={wf.id}>{wf.name}</option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="workspace">
        <NodePalette />
        <NodeCanvas onNodeSelect={setSelectedNode} />
      </div>
      
      {selectedNode && (
        <div className="properties-panel">
          <h3>节点属性</h3>
          <p>节点ID: {selectedNode}</p>
          {/* 这里可以添加具体的节点配置表单 */}
        </div>
      )}
    </div>
  );
};