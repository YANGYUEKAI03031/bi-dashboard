// frontend/bi-dashboard/src/components/navigation/Sidebar.tsx
import React from 'react';
import './Sidebar.css';
import { Link, useLocation } from 'react-router-dom';

interface SidebarItem {
  id: string;
  title: string;
  icon?: string;
  path: string;
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', title: '仪表板', path: '/dashboard', icon: '📊' },
  { id: 'reports', title: '报表中心', path: '/reports', icon: '📈' },
  { id: 'analytics', title: '数据分析', path: '/analytics', icon: '🔍' },
  { id: 'database', title: '数据库浏览器', path: '/database', icon: '🗄️' },
];

export const Sidebar: React.FC = () => {
  const location = useLocation();
  
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h3>导航菜单</h3>
      </div>
      <ul className="sidebar-menu">
        {sidebarItems.map((item) => (
          <li key={item.id}>
            <Link 
              to={item.path}
              className={`sidebar-link ${location.pathname === item.path ? 'active' : ''}`}
            >
              {item.icon && <span className="sidebar-icon">{item.icon}</span>}
              <span className="sidebar-text">{item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};