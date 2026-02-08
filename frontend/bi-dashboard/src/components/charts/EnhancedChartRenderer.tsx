// src/components/charts/EnhancedChartRenderer.tsx
import React, { useMemo } from 'react';
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
  RadialLinearScale,
  ChartOptions
} from 'chart.js';
import { Bar, Line, Pie, Doughnut, Radar, Scatter } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  RadialLinearScale
);

interface EnhancedChartRendererProps {
  config: any;
  data: any;
  width?: number;
  height?: number;
  onDrillDown?: (dataPoint: any) => void;
}

export const EnhancedChartRenderer: React.FC<EnhancedChartRendererProps> = ({
  config,
  data,
  width = 600,
  height = 400,
  onDrillDown
}) => {
  const chartOptions: ChartOptions<any> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top' as const,
          labels: {
            padding: 20,
            usePointStyle: true
          }
        },
        title: {
          display: true,
          text: config.title,
          font: {
            size: 16,
            weight: 'bold' as const
          }
        },
        tooltip: {
          callbacks: {
            label: function(context: any) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += new Intl.NumberFormat('zh-CN').format(context.parsed.y);
              }
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.1)'
          }
        },
        y: {
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.1)'
          }
        }
      },
      onClick: onDrillDown ? (event: any, elements: any[]) => {
        if (elements.length > 0) {
          const element = elements[0];
          const dataPoint = data.datasets[element.datasetIndex].data[element.index];
          onDrillDown({
            datasetIndex: element.datasetIndex,
            index: element.index,
            value: dataPoint
          });
        }
      } : undefined
    };
  }, [config.title, data, onDrillDown]);

  const renderChart = () => {
    const chartContainerStyle = {
      width: `${width}px`,
      height: `${height}px`,
      position: 'relative' as const
    };

    switch (config.type) {
      case 'bar':
        return (
          <div style={chartContainerStyle}>
            <Bar data={data} options={chartOptions} />
          </div>
        );
      
      case 'line':
        return (
          <div style={chartContainerStyle}>
            <Line data={data} options={chartOptions} />
          </div>
        );
      
      case 'area':
        const areaData = {
          ...data,
          datasets: data.datasets.map((dataset: any) => ({
            ...dataset,
            fill: true
          }))
        };
        return (
          <div style={chartContainerStyle}>
            <Line data={areaData} options={chartOptions} />
          </div>
        );
      
      case 'pie':
        return (
          <div style={chartContainerStyle}>
            <Pie data={data} options={chartOptions} />
          </div>
        );
      
      case 'doughnut':
        return (
          <div style={chartContainerStyle}>
            <Doughnut data={data} options={chartOptions} />
          </div>
        );
      
      case 'radar':
        return (
          <div style={chartContainerStyle}>
            <Radar data={data} options={chartOptions} />
          </div>
        );
      
      case 'scatter':
        return (
          <div style={chartContainerStyle}>
            <Scatter data={data} options={chartOptions} />
          </div>
        );
      
      default:
        return <div>不支持的图表类型: {config.type}</div>;
    }
  };

  return renderChart();
};