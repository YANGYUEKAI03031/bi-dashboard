import React from 'react';
import './DataChainPage.css';

export const DataChainPage: React.FC = () => {
  return (
    <div className="data-chain-page">
      <div className="page-header">
        <h1>数据链路</h1>
        <p>构建和管理数据处理流程</p>
      </div>
      
      <div className="data-chain-content">
        <div className="chain-builder">
          <div className="toolbox">
            <h3>工具箱</h3>
            <div className="tool-item">数据源</div>
            <div className="tool-item">数据处理</div>
            <div className="tool-item">数据可视化</div>
          </div>
          
          <div className="canvas-area">
            <div className="canvas-placeholder">
              <p>拖拽组件到这里构建数据链路</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};