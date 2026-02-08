// src/components/charts/ChartRenderer.tsx
import React, { useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';
import * as echarts from 'echarts';
import { ChartConfig, ChartType } from '../../services/chartService'; // 修改这行：移除 'type' 关键字

// 注册Chart.js组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface ChartRendererProps {
  config: ChartConfig;
  data: any;
  width?: number;
  height?: number;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({
  config,
  data,
  width = 600,
  height = 400
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const echartsInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (config.type === ChartType.SCATTER && chartRef.current) {
      // 使用ECharts渲染散点图
      if (!echartsInstance.current) {
        echartsInstance.current = echarts.init(chartRef.current);
      }
      
      const option: echarts.EChartsOption = {
        title: {
          text: config.title,
          left: 'center'
        },
        tooltip: {
          trigger: 'item',
          formatter: '{a} <br/>{b} : {c}'
        },
        xAxis: {
          type: 'value',
          name: config.xAxis?.title || 'X轴'
        },
        yAxis: {
          type: 'value',
          name: config.yAxis?.title || 'Y轴'
        },
        series: [{
          name: config.series[0]?.name || '数据',
          type: 'scatter',
          data: data.points || [],
          symbolSize: 10
        }]
      };
      
      echartsInstance.current.setOption(option);
    }

    return () => {
      if (echartsInstance.current) {
        echartsInstance.current.dispose();
        echartsInstance.current = null;
      }
    };
  }, [config, data]);

  const renderChartJSComponent = () => {
    const commonOptions = {
      responsive: true,
      plugins: {
        legend: {
          position: 'top' as const,
        },
        title: {
          display: true,
          text: config.title,
        },
      },
    };

    const chartData = {
      labels: data.labels || [],
      datasets: config.series.map((series, index) => ({
        label: series.name,
        data: data.datasets?.[index] || [],
        backgroundColor: series.color || `hsl(${index * 60}, 70%, 50%)`,
        borderColor: series.color || `hsl(${index * 60}, 70%, 50%)`,
        tension: 0.1,
      })),
    };

    switch (config.type) {
      case ChartType.BAR:
        return <Bar options={commonOptions} data={chartData} />;
      case ChartType.LINE:
        return <Line options={commonOptions} data={chartData} />;
      case ChartType.PIE:
        return <Pie options={commonOptions} data={chartData} />;
      case ChartType.AREA:
        // Area chart using Line with fill
        const areaOptions = {
          ...commonOptions,
          elements: {
            line: {
              fill: true,
            },
          },
        };
        return <Line options={areaOptions} data={chartData} />;
      case ChartType.COMBO:
        // 组合图表处理
        return <div>组合图表功能待实现</div>;
      default:
        return <div>不支持的图表类型: {config.type}</div>;
    }
  };

  if (config.type === ChartType.SCATTER) {
    return (
      <div 
        ref={chartRef} 
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    );
  }

  return (
    <div style={{ width: `${width}px`, height: `${height}px` }}>
      {renderChartJSComponent()}
    </div>
  );
};