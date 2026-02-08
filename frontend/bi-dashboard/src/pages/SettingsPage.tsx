import React from 'react';
import './SettingsPage.css';

export const SettingsPage: React.FC = () => {
  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>系统设置</h1>
        <p>配置系统参数和用户偏好</p>
      </div>
      
      <div className="settings-content">
        <div className="settings-section">
          <h2>数据源配置</h2>
          <div className="setting-item">
            <label>数据库连接</label>
            <button className="btn-secondary">配置连接</button>
          </div>
        </div>
        
        <div className="settings-section">
          <h2>用户管理</h2>
          <div className="setting-item">
            <label>用户权限</label>
            <button className="btn-secondary">管理用户</button>
          </div>
        </div>
      </div>
    </div>
  );
};