import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart import as it's not available
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiverChart as ThemeRiver,
  CustomChart
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react';

// 注册必需的组件
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  GaugeChart,
  BoxplotChart,
  GraphChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  SankeyChart,
  ThemeRiverChart,
  // Removed CalendarChart registration
  EffectScatterChart,
  LinesChart,
  PictorialBarChart,
  ThemeRiver,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  TimelineComponent,
  CalendarComponent, // Keep CalendarComponent for calendar coordinate system
  GraphicComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
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
  xField?: string; // X轴字段
  yFields?: string[]; // Y轴字段数组
  colorField?: string; // 颜色分组字段
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
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 监听容器大小变化
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);
  
  const option = useMemo(() => {
    // 处理xAxis数据 - 使用配置的xField
    const xField = config.xField || (Object.keys(data[0] || {})[0]) || '';
    const xAxisData = data.map(item => {
      if (!item) return '';
      
      // 支持多种数据格式
      if (typeof item === 'object' && item !== null) {
        // 对象格式：直接访问字段
        if (xField in item) {
          const value = item[xField];
          // 如果是日期格式，保持原样；否则转为字符串
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
            return value;
          }
          return String(value);
        }
        // 嵌套对象：尝试访问子属性
        if (xField.includes('.')) {
          const keys = xField.split('.');
          let value = item;
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              break;
            }
          }
          if (value !== undefined) {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              return value;
            }
            return String(value);
          }
        }
        // 数组格式：取第一个元素
        if (Array.isArray(item) && item.length > 0) {
          const firstValue = item[0];
          if (typeof firstValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(firstValue)) {
            return firstValue;
          }
          return String(firstValue);
        }
      }
      
      // 基本类型
      return String(item);
    });

    // 处理系列数据 - 使用配置的yFields
    let yFields = config.yFields || config.series.map(s => s.field) || [];

    // 如果yFields为空且有数据，尝试自动检测数值字段
    if (yFields.length === 0 && data.length > 0 && data[0]) {
      const firstItem = data[0];
      if (typeof firstItem === 'object') {
        // 检测数值字段
        const numericFields = Object.keys(firstItem).filter(key => {
          const value = firstItem[key];
          return typeof value === 'number' || 
                 (typeof value === 'string' && /^-?\d+\.?\d*$/.test(value));
        });
        
        if (numericFields.length > 0) {
          console.log('自动检测到数值字段:', numericFields);
          yFields = numericFields.slice(0, 3); // 最多3个字段
        }
      }
    }
    
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
        data: yFields.map(field => field),
        bottom: 10
      },
      grid: config.grid || {
        left: containerSize.width > 800 ? '5%' : '10%',
        right: containerSize.width > 800 ? '5%' : '10%',
        bottom: containerSize.height > 400 ? '20%' : '25%',
        top: containerSize.height > 400 ? '10%' : '15%',
        containLabel: true
      },
      xAxis: {
        ...config.xAxis,
        type: 'category',
        data: xAxisData,
        name: config.xAxis?.name || 'X轴',
        // 对于日期数据，添加时间轴格式化
        axisLabel: {
          formatter: function(value) {
            // 如果是日期格式，保持原样
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
              return value;
            }
            // 对于长文本，进行截断或换行
            if (typeof value === 'string' && value.length > 10) {
              return value.substring(0, 8) + '...';
            }
            return value;
          },
          rotate: containerSize.width < 600 ? 45 : 0,
          margin: 15
        }
      },
      yAxis: {
        ...config.yAxis,
        type: 'value',
        name: config.yAxis?.name || 'Y轴'
      }
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'bar',
          data: data.map(item => item[field] || 0),
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'line':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'line',
          data: data.map(item => item[field] || 0),
          smooth: true,
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'area':
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'line',
          data: data.map(item => item[field] || 0),
          smooth: true,
          areaStyle: {},
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
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
        
        if (yFields.length > 0) {
          const fieldValue = yFields[0]; // 饼图通常只需要一个数值字段
          baseOption.series = [{
            type: 'pie',
            radius: ['40%', '70%'],
            data: data.map((item, index) => ({
              name: item[xField] || `数据${index + 1}`,
              value: item[fieldValue] || 0
            })),
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }];
        }
        break;
        
      case 'scatter':
        baseOption.xAxis.type = 'value';
        baseOption.yAxis.type = 'value';
        if (yFields.length >= 2) {
          baseOption.series = [{
            name: '散点图',
            type: 'scatter',
            data: data.map(item => [item[yFields[0]] || 0, item[yFields[1]] || 0]),
            symbolSize: 10
          }];
          // 移除不必要的轴配置
          delete baseOption.xAxis.data;
          delete baseOption.xAxis.name;
          delete baseOption.yAxis.name;
        }
        break;
        
      case 'heatmap':
        // 热力图需要特殊的二维数据格式
        baseOption.visualMap = {
          min: 0,
          max: Math.max(...data.map(item => Math.max(...yFields.map(field => item[field] || 0)))),
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '15%'
        };
        baseOption.series = [{
          name: '热力图',
          type: 'heatmap',
          data: data.map((item, rowIndex) => 
            yFields.map((field, colIndex) => [colIndex, rowIndex, item[field] || 0])
          ).flat(),
          label: {
            show: true
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          }
        }];
        baseOption.xAxis = {
          type: 'category',
          data: yFields
        };
        baseOption.yAxis = {
          type: 'category',
          data: xAxisData
        };
        break;
        
      default:
        // 默认使用柱状图
        baseOption.series = yFields.map(field => ({
          name: field,
          type: 'bar',
          data: data.map(item => item[field] || 0)
        }));
    }

    // 如果有颜色分组字段，添加颜色映射
    if (config.colorField && config.colorField !== '') {
      baseOption.visualMap = {
        show: false,
        dimension: 2,
        pieces: [
          { gt: 0, color: '#5470c6' },
          { gt: 100, color: '#91cc75' },
          { gt: 200, color: '#fac858' },
          { gt: 300, color: '#ee6666' },
          { gt: 400, color: '#73c0de' }
        ]
      };
    }

    return baseOption;
  }, [config, data]);

  // 添加调试信息
  console.log('ChartFactory props:', { config, data });
  console.log('Generated option:', option);

  return (
    <div ref={containerRef} style={{ width: '100%', ...style }}>
      <ReactECharts
        option={option}
        notMerge={true}
        lazyUpdate={true}
        style={{ height: '100%' }}
        onEvents={onEvents}
      />
    </div>
  );
};