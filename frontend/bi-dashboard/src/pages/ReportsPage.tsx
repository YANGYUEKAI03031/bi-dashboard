import React from 'react';
import './ReportsPage.css';

export const ReportsPage: React.FC = () => {
  return (
    <div className="reports-page">
      <div className="page-header">
        <h1>报表中心</h1>
        <p>生成和管理各类业务报表</p>
      </div>
      
      <div className="reports-content">
        <div className="report-list">
          <div className="report-item">
            <h3>销售报表</h3>
            <p>按时间段统计销售数据</p>
            <button className="btn-primary">生成报表</button>
          </div>
          
          <div className="report-item">
            <h3>用户报表</h3>
            <p>用户行为和 demographics 分析</p>
            <button className="btn-primary">生成报表</button>
          </div>
          
          <div className="report-item">
            <h3>财务报表</h3>
            <p>收入、支出和利润分析</p>
            <button className="btn-primary">生成报表</button>
          </div>
        </div>
      </div>
    </div>
  );
};