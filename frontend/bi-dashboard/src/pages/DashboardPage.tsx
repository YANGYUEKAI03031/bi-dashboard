import React from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import './DashboardPage.css';

export const DashboardPage: React.FC = () => {
  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <div className="dashboard-content">
          <h2>仪表板</h2>
          <p>欢迎来到BI仪表板系统</p>
          
          {/* 这里可以添加你的仪表板内容 */}
          <div className="dashboard-widgets">
            <div className="widget">
              <h3>销售数据</h3>
              <p>本月销售额：¥1,234,567</p>
            </div>
            <div className="widget">
              <h3>用户统计</h3>
              <p>活跃用户：1,234人</p>
            </div>
            <div className="widget">
              <h3>系统状态</h3>
              <p>运行正常</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};