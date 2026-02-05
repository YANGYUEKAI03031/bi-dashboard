// src/pages/AnalyticsPage.tsx
import React from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import './AnalyticsPage.css';

export const AnalyticsPage: React.FC = () => {
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <div className="dashboard-content">
          <h2>数据分析</h2>
          <p>深入分析业务数据，发现洞察和趋势</p>
          
          <div className="analytics-section">
            <div className="chart-container">
              <h3>销售趋势图</h3>
              <div className="chart-placeholder">
                [图表区域 - 这里可以集成 Chart.js 或其他图表库]
              </div>
            </div>
            <div className="chart-container">
              <h3>用户分布图</h3>
              <div className="chart-placeholder">
                [图表区域 - 这里可以集成 Chart.js 或其他图表库]
              </div>
            </div>
          </div>
          
          <div className="data-summary">
            <div className="summary-card">
              <h4>总销售额</h4>
              <p className="summary-value">¥1,234,567</p>
            </div>
            <div className="summary-card">
              <h4>用户增长率</h4>
              <p className="summary-value">+15.3%</p>
            </div>
            <div className="summary-card">
              <h4>转化率</h4>
              <p className="summary-value">3.2%</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};