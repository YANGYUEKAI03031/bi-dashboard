// src/pages/ReportsPage.tsx
import React from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import './ReportsPage.css';

export const ReportsPage: React.FC = () => {
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <div className="dashboard-content">
          <h2>报表中心</h2>
          <p>查看和管理各类业务报表</p>
          
          <div className="reports-grid">
            <div className="report-card">
              <h3>销售报表</h3>
              <p>查看销售数据统计和趋势分析</p>
              <button className="report-btn">查看详情</button>
            </div>
            <div className="report-card">
              <h3>用户报表</h3>
              <p>分析用户行为和活跃度数据</p>
              <button className="report-btn">查看详情</button>
            </div>
            <div className="report-card">
              <h3>财务报表</h3>
              <p>查看收入支出和财务状况</p>
              <button className="report-btn">查看详情</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};