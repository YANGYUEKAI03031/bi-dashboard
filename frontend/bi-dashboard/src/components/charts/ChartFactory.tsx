// frontend/bi-dashboard/src/components/charts/ChartFactory.tsx
import React, { useMemo } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react';

// 注册必需的组件
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  CanvasRenderer
]);

interface ChartConfig {
  type: string;
  title?: string;
  xAxis?: any;
  yAxis?: any;
  series: any[];
  legend?: any;
  tooltip?: any;
  grid?: any;
}

interface ChartFactoryProps {
  config: ChartConfig;
  data: any[];
  style?: React.CSSProperties;
  onEvents?: Record<string, Function>;
}

export const ChartFactory: React.FC<ChartFactoryProps> = ({
  config,
  data,
  style = { height: '400px' },
  onEvents
}) => {
  const option = useMemo(() => {
    // 处理xAxis数据
    const xAxisData = data.map(item => {
      // 假设第一列是x轴数据
      const keys = Object.keys(item);
      return item[keys[0]] || '';
    });

    const baseOption: any = {
      title: {
        text: config.title || '',
        left: 'center'
      },
      tooltip: config.tooltip || {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        }
      },
      legend: config.legend || {
        data: config.series.map(s => s.name || s.field),
        bottom: 10
      },
      grid: config.grid || {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true
      },
      xAxis: {
        ...config.xAxis,
        type: 'category',
        data: xAxisData
      },
      yAxis: {
        ...config.yAxis,
        type: 'value'
      },
      series: config.series.map(series => ({
        ...series,
        type: config.type,
        name: series.name || series.field,
        data: data.map(item => item[series.field] || 0)
      }))
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar':
        break;
      case 'line':
        break;
      case 'pie':
        baseOption.tooltip = {
          trigger: 'item'
        };
        baseOption.legend = {
          top: 'bottom'
        };
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        baseOption.series = [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: data.map((item, index) => {
            const keys = Object.keys(item);
            return {
              name: item[keys[0]] || `数据${index + 1}`,
              value: item[keys[1]] || 0
            };
          }),
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          }
        }];
        break;
      case 'scatter':
        baseOption.xAxis.type = 'value';
        baseOption.yAxis.type = 'value';
        break;
    }

    return baseOption;
  }, [config, data]);

  // 添加调试信息
  console.log('ChartFactory props:', { config, data });
  console.log('Generated option:', option);

  return (
    <ReactECharts
      option={option}
      style={style}
      onEvents={onEvents}
      notMerge={true}
      lazyUpdate={true}
    />
  );
};