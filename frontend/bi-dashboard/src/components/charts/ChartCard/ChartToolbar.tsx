// src/components/charts/ChartCard/ChartToolbar.tsx
import React from 'react';
import './ChartToolbar.css';

interface ChartConfig {
  type: string;
  title: string;
  xAxis?: { field: string; title: string };
  yAxis?: { field: string; title: string };
  series: any[];
  dataBinding: any;
  styling: any;
}

interface ChartToolbarProps {
  config: ChartConfig;
  onConfigChange: () => void;
  onRefresh: () => void;
  editable?: boolean;
}

export const ChartToolbar: React.FC<ChartToolbarProps> = ({
  config,
  onConfigChange,
  onRefresh,
  editable = false
}) => {
  const handleExport = () => {
    console.log('导出图表:', config.title);
  };

  const handleFullscreen = () => {
    console.log('全屏显示图表');
  };

  return (
    <div className="chart-toolbar">
      <div className="toolbar-title">{config.title}</div>
      <div className="toolbar-actions">
        {editable && (
          <button 
            className="toolbar-btn"
            onClick={onConfigChange}
            title="编辑图表"
          >
            ✏️
          </button>
        )}
        <button 
          className="toolbar-btn"
          onClick={handleExport}
          title="导出图表"
        >
          📥
        </button>
        <button 
          className="toolbar-btn"
          onClick={handleFullscreen}
          title="全屏显示"
        >
          ↗️
        </button>
        <button 
          className="toolbar-btn"
          onClick={onRefresh}
          title="刷新数据"
        >
          🔄
        </button>
      </div>
    </div>
  );
};