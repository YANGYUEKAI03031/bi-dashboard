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
        data: [],
        bottom: 10
      },
      grid: config.grid || {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true
      },
      xAxis: config.xAxis || {},
      yAxis: config.yAxis || {},
      series: config.series.map(series => ({
        ...series,
        data: data.map(item => item[series.field] || 0)
      }))
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar':
        baseOption.xAxis.type = baseOption.xAxis.type || 'category';
        baseOption.yAxis.type = baseOption.yAxis.type || 'value';
        break;
      case 'line':
        baseOption.xAxis.type = baseOption.xAxis.type || 'category';
        baseOption.yAxis.type = baseOption.yAxis.type || 'value';
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
          data: data.map((item, index) => ({
            name: item.name || `数据${index + 1}`,
            value: item.value || 0
          })),
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
        baseOption.xAxis.type = baseOption.xAxis.type || 'value';
        baseOption.yAxis.type = baseOption.yAxis.type || 'value';
        break;
    }

    return baseOption;
  }, [config, data]);

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