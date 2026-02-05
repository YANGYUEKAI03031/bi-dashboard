// src/pages/SettingsPage.tsx
import React, { useState } from 'react';
import { Sidebar } from '../components/navigation/Sidebar';
import './SettingsPage.css';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState({
    notifications: true,
    theme: 'light',
    language: 'zh-CN',
    autoSave: true
  });

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />
      <main className="dashboard-main">
        <div className="dashboard-content">
          <h2>系统设置</h2>
          <p>配置系统参数和个性化选项</p>
          
          <div className="settings-container">
            <div className="setting-group">
              <h3>通知设置</h3>
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.notifications}
                    onChange={(e) => handleSettingChange('notifications', e.target.checked)}
                  />
                  启用系统通知
                </label>
              </div>
            </div>
            
            <div className="setting-group">
              <h3>界面设置</h3>
              <div className="setting-item">
                <label>主题模式：</label>
                <select
                  value={settings.theme}
                  onChange={(e) => handleSettingChange('theme', e.target.value)}
                >
                  <option value="light">浅色主题</option>
                  <option value="dark">深色主题</option>
                </select>
              </div>
              <div className="setting-item">
                <label>语言：</label>
                <select
                  value={settings.language}
                  onChange={(e) => handleSettingChange('language', e.target.value)}
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
            </div>
            
            <div className="setting-group">
              <h3>数据设置</h3>
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(e) => handleSettingChange('autoSave', e.target.checked)}
                  />
                  自动保存数据
                </label>
              </div>
            </div>
            
            <button className="save-settings-btn">保存设置</button>
          </div>
        </div>
      </main>
    </div>
  );
};