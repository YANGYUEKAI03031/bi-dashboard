import React, { useState } from 'react';
import { ChartCard } from '../components/charts/ChartCard/ChartCard';
import './AnalyticsPage.css';

// 定义统一的图表配置接口
interface ChartConfig {
  id?: string;
  type: string;
  title: string;
  xAxis?: { field: string; title: string };
  yAxis?: { field: string; title: string };
  series: any[];
  dataBinding: any;
  styling: any;
}

export const AnalyticsPage: React.FC = () => { // 改为命名导出
  const [charts, setCharts] = useState<ChartConfig[]>([
    {
      id: 'chart1',
      type: 'bar',
      title: '销售趋势图',
      xAxis: { field: 'month', title: '月份' },
      yAxis: { field: 'sales', title: '销售额' },
      series: [{ name: '销售额', type: 'bar', dataField: 'sales' }],
      dataBinding: {
        dataSource: 'mysql_db',
        query: 'SELECT month, sales FROM sales_data'
      },
      styling: {
        colors: ['#3b82f6'],
        theme: 'light',
        showLegend: true,
        showTooltip: true
      }
    },
    {
      id: 'chart2',
      type: 'pie',
      title: '用户分布图',
      series: [{ name: '用户数', type: 'pie', dataField: 'count' }],
      dataBinding: {
        dataSource: 'mysql_db',
        query: 'SELECT region, count FROM user_distribution'
      },
      styling: {
        colors: ['#ef4444', '#10b981', '#f59e0b'],
        theme: 'light',
        showLegend: true,
        showTooltip: true
      }
    }
  ]);

  const handleChartConfigChange = (index: number, newConfig: ChartConfig) => {
    setCharts(prev => {
      const updated = [...prev];
      updated[index] = newConfig;
      return updated;
    });
  };

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h1>数据分析</h1>
        <p>创建和管理您的数据可视化图表</p>
      </div>
      
      <div className="charts-grid">
        {charts.map((chart, index) => (
          <div key={chart.id || index} className="chart-container">
            <ChartCard
              config={chart}
              onConfigChange={(newConfig) => handleChartConfigChange(index, newConfig)}
              editable={true}
              width={600}
              height={400}
            />
          </div>
        ))}
      </div>
    </div>
  );
};