// src/components/DatabaseExplorer/DatabaseStats.tsx
import React, { useState, useEffect } from 'react';

interface DatabaseStatsProps {
  onLoadStats?: () => Promise<any>;
  data?: any;
}

export const DatabaseStats: React.FC<DatabaseStatsProps> = ({ onLoadStats, data }) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadStats = async () => {
    if (!onLoadStats) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const statistics = await onLoadStats();
      setStats(statistics);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载统计信息失败'));
    } finally {
      setLoading(false);
    }
  };

  // 如果直接提供了数据，则使用该数据
  useEffect(() => {
    if (data) {
      setStats(data);
      setLoading(false);
      setError(null);
    } else if (onLoadStats) {
      loadStats();
    }
  }, [data, onLoadStats]);

  if (loading) {
    return <div className="stats-loading">加载统计信息中...</div>;
  }

  if (error) {
    return (
      <div className="stats-error">
        <p>加载失败: {error.message}</p>
        <button onClick={loadStats}>重新加载</button>
      </div>
    );
  }

  if (!stats) {
    return <div className="stats-empty">暂无统计信息</div>;
  }

  return (
    <div className="database-stats">
      <div className="stats-header">
        <h3>数据库统计信息</h3>
        {onLoadStats && (
          <button onClick={loadStats} className="refresh-btn">
            刷新
          </button>
        )}
      </div>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">数据库名称</div>
          <div className="stat-value">{stats.database}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">表数量</div>
          <div className="stat-value">{stats.tableCount}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">总行数</div>
          <div className="stat-value">{stats.totalRows?.toLocaleString()}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">数据库大小</div>
          <div className="stat-value">{stats.sizeMB} MB</div>
        </div>
      </div>
    </div>
  );
};