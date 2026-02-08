import React from 'react';
import './DashboardPage.css';

export const DashboardPage: React.FC = () => {
  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>仪表盘</h1>
        <p>查看关键业务指标和数据概览</p>
      </div>
      
      <div className="dashboard-content">
        <div className="kpi-cards">
          <div className="kpi-card">
            <h3>总销售额</h3>
            <p className="kpi-value">¥1,234,567</p>
            <span className="kpi-trend positive">↑ 12.5%</span>
          </div>
          
          <div className="kpi-card">
            <h3>用户数量</h3>
            <p className="kpi-value">12,345</p>
            <span className="kpi-trend positive">↑ 8.2%</span>
          </div>
          
          <div className="kpi-card">
            <h3>订单数量</h3>
            <p className="kpi-value">1,234</p>
            <span className="kpi-trend negative">↓ 2.1%</span>
          </div>
        </div>
        
        <div className="chart-section">
          <div className="chart-placeholder">
            <h3>销售趋势图</h3>
            <p>图表数据加载中...</p>
          </div>
        </div>
      </div>
    </div>
  );
};