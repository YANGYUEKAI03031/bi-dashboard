import React, { useState, useEffect } from 'react';
import { chartApiService, ChartResponse } from '../../services/chartApiService';
import './ChartList.css';

interface ChartListProps {
  onCreateNew: () => void;
  onEdit: (chart: ChartResponse) => void;
  onDelete: (chartId: number) => void;
}

export const ChartList: React.FC<ChartListProps> = ({
  onCreateNew,
  onEdit,
  onDelete
}) => {
  const [charts, setCharts] = useState<ChartResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCharts();
  }, []);

  const loadCharts = async () => {
    try {
      setLoading(true);
      const chartList = await chartApiService.getCharts();
      setCharts(chartList);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载失败';
      setError(errorMessage);
      console.error('加载图表列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (chartId: number) => {
    if (window.confirm('确定要删除这个图表吗？')) {
      try {
        await chartApiService.deleteChart(chartId);
        setCharts(charts.filter(chart => chart.id !== chartId));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '删除失败';
        alert(errorMessage);
        console.error('删除图表失败:', err);
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="chart-list">
      <div className="chart-list-header">
        <h2>图表列表</h2>
        <button 
          className="btn btn-primary" 
          onClick={onCreateNew}
        >
          创建新图表
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="chart-grid">
        {charts.map(chart => (
          <div key={chart.id} className="chart-card">
            <div className="chart-card-header">
              <h3>{chart.name}</h3>
              <div className="chart-actions">
                <button 
                  className="btn btn-sm btn-secondary"
                  onClick={() => onEdit(chart)}
                >
                  编辑
                </button>
                <button 
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(chart.id)}
                >
                  删除
                </button>
              </div>
            </div>
            
            <div className="chart-info">
              <div className="chart-info-item">
                <span className="info-label">类型:</span>
                <span className="info-value">{chart.chart_type}</span>
              </div>
              <div className="chart-info-item">
                <span className="info-label">数据源:</span>
                <span className="info-value">
                  {chart.data_source_name || `ID: ${chart.data_source_id}`}
                </span>
              </div>
              <div className="chart-info-item">
                <span className="info-label">创建时间:</span>
                <span className="info-value">{formatDate(chart.created_at)}</span>
              </div>
            </div>

            {chart.description && (
              <div className="chart-description">
                {chart.description}
              </div>
            )}
          </div>
        ))}
      </div>

      {charts.length === 0 && !loading && (
        <div className="empty-state">
          <p>暂无图表数据</p>
          <button 
            className="btn btn-primary" 
            onClick={onCreateNew}
          >
            创建第一个图表
          </button>
        </div>
      )}
    </div>
  );
};