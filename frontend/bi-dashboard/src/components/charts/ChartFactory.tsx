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
  sort_by?: 'x' | 'y'; // 排序方式: 'x' 或 'y'
  sort_order?: 'asc' | 'desc'; // 排序顺序: 'asc' 或 'desc'
  minHeight?: number; // 图表容器最小高度（px）
}

interface ChartFactoryProps {
  config: ChartConfig;
  data: any[];
  style?: React.CSSProperties;
  onEvents?: Record<string, Function>;
  minHeight?: number; // 优先级高于 config.minHeight
}

export const ChartFactory: React.FC<ChartFactoryProps> = ({
  config,
  data,
  style = { height: '400px' },
  onEvents,
  minHeight
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReactECharts>(null);
  const [isReady, setIsReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  
  // 监听容器大小变化
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
        setContainerSize(prev =>
          prev.width === nextWidth && prev.height === nextHeight ? prev : { width: nextWidth, height: nextHeight }
        );
        // Only mark ready once we have a real size; after that, just resize the chart.
        if (!isReady && rect.width > 0 && rect.height > 0) {
          setIsReady(true);
        }
        const instance = chartRef.current?.getEchartsInstance?.();
        if (instance && rect.width > 0 && rect.height > 0) {
          instance.resize();
        }
      }
    };

    const scheduleUpdate = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSize);
    };
    
    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, [isReady]);
  
  const option = useMemo(() => {
    const containerHeight = containerSize.height;
    const compact = containerHeight > 0 && containerHeight < 220;
    const veryCompact = containerHeight > 0 && containerHeight < 160;

    // 处理xAxis数据 - 使用配置的xField
    const xField = config.xField || (Object.keys(data[0] || {})[0]) || '';
    
    // 排序处理
    let sortedData = [...data];
    console.log('=== 排序处理开始 ===');
    console.log('原始数据:', data);
    console.log('配置信息:', { sort_by: config.sort_by, sort_order: config.sort_order, xField: xField });
    
    if (config.sort_by && config.sort_order) {
      console.log('开始执行排序逻辑');
      if (config.sort_by === 'x') {
        // 按X轴字段排序
        console.log('按X轴排序:', xField);
        sortedData.sort((a, b) => {
          const valA = a[xField];
          const valB = b[xField];
          console.log('比较值:', { valA, valB });
          
          if (typeof valA === 'number' && typeof valB === 'number') {
            const result = config.sort_order === 'asc' ? valA - valB : valB - valA;
            console.log('数字排序结果:', result);
            return result;
          }
          
          const result = config.sort_order === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
          console.log('字符串排序结果:', result);
          return result;
        });
      } else if (config.sort_by === 'y' && config.yFields && config.yFields.length > 0) {
        // 按第一个Y轴字段排序
        const yField = config.yFields[0];
        console.log('按Y轴排序:', yField);
        sortedData.sort((a, b) => {
          const valA = a[yField];
          const valB = b[yField];
          console.log('比较值:', { valA, valB });
          
          if (typeof valA === 'number' && typeof valB === 'number') {
            const result = config.sort_order === 'asc' ? valA - valB : valB - valA;
            console.log('数字排序结果:', result);
            return result;
          }
          
          const result = config.sort_order === 'asc' 
            ? String(valA).localeCompare(String(valB)) 
            : String(valB).localeCompare(String(valA));
          console.log('字符串排序结果:', result);
          return result;
        });
      }
      console.log('排序后数据:', sortedData);
    } else {
      console.log('跳过排序 - 缺少必要配置');
    }
    
    const xAxisData = sortedData.map(item => {
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
          yFields = numericFields; // 使用所有检测到的数值字段
        }
      }
    }
    
    // 默认颜色调色板
    const colorPalette = [
      '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
      '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#ff9f7f'
    ];

    // 估算 X 轴多行 label 占用高度，避免与底部 legend 重叠（仅用于默认 grid 配置）
    const estimateXAxisLabelLines = (val: unknown) => {
      // 面板太矮时，避免换行导致 plot 区域被严重挤压
      if (compact) return 1;
      if (typeof val !== 'string') return 1;
      // 日期不换行
      if (/^\d{4}-\d{2}-\d{2}/.test(val)) return 1;
      if (val.length <= 10) return 1;
      return Math.max(1, Math.ceil(val.length / 6));
    };
    const maxXAxisLabelLines = xAxisData.reduce((max, v) => Math.max(max, estimateXAxisLabelLines(v)), 1);

    const axisLabelFromConfig = config.xAxis?.axisLabel || {};
    const axisLabelFontSize = axisLabelFromConfig.fontSize ?? 11;
    const axisLabelMargin = axisLabelFromConfig.margin ?? 15;
    const xAxisNameGap = config.xAxis?.nameGap ?? 32;

    const effectiveAxisLabelFontSize = compact ? Math.max(9, Math.round(axisLabelFontSize * 0.9)) : axisLabelFontSize;
    const effectiveAxisLabelMargin = compact ? Math.min(axisLabelMargin, 10) : axisLabelMargin;
    const effectiveXAxisNameGap = compact ? Math.min(xAxisNameGap, 22) : xAxisNameGap;
    const xAxisLabelHeightEstimate = maxXAxisLabelLines * (effectiveAxisLabelFontSize + 4);
    
    // X 轴名称（如"支付日期"）的高度估算
    const xAxisNameFontSize = config.xAxis?.nameTextStyle?.fontSize ?? 12;
    const xAxisNameHeight = compact ? Math.max(10, Math.round(xAxisNameFontSize * 0.9)) : xAxisNameFontSize;
    
    // 预留给 xAxis（label + name + margin）的底部空间
    // 包括：底部边距 + 标签高度 + 标签与轴的间距 + name与label的间距 + name本身的高度
    const breathingRoom = compact ? Math.max(8, 10 * 0.8) : 10;
    const xAxisReservedBottom =
      breathingRoom + 
      xAxisLabelHeightEstimate + 
      effectiveAxisLabelMargin + 
      effectiveXAxisNameGap + 
      xAxisNameHeight + 
      4; // name 下方的额外边距
    
    // 图例高度估算（一行图例的高度 + padding）
    const legendHeightEstimate = 34;
    // 图例和X轴名称之间的间距（需要足够大以避免重叠）
    const gapBetweenXAxisAndLegend = compact ? Math.max(12, 15 * 0.8) : 18;
    
    // 判断是否需要显示图例
    const shouldShowLegend = !compact && yFields.length > 1 && (config.legend?.show !== false);
    
    // 计算 grid.bottom：包含 X 轴标签和图例的总高度
    // 让图例成为图表的一部分，通过 grid 统一管理空间，避免重叠
    // grid.bottom 需要为：X轴空间 + 图例和X轴的间距 + 图例高度
    const totalBottomSpace = shouldShowLegend 
      ? xAxisReservedBottom + gapBetweenXAxisAndLegend + legendHeightEstimate
      : xAxisReservedBottom;
    
    const gridBottomEstimate = Math.max(60, totalBottomSpace);

    // 避免容器高度变小后，固定像素的 bottom 预留把 plot 区域"挤没了"
    const gridBottomMax = containerHeight > 0 ? Math.max(48, Math.floor(containerHeight * 0.7)) : gridBottomEstimate;
    const gridBottomFinal = Math.min(gridBottomEstimate, gridBottomMax);
    
    // 图例配置：作为图表的一部分，放在 X 轴标签下方
    // 图例的 bottom 值设置为 X 轴占用的空间，让图例紧贴 X 轴下方
    // 间距通过 grid.bottom 预留，而不是在图例的 bottom 中加上间距
    const defaultLegendOption: any = {
      data: yFields.map(field => field),
      // 图例紧贴 X 轴下方，bottom 值等于 X 轴占用的空间
      // 这样图例不会有固定底部间距，而是根据 X 轴实际占用空间动态定位
      bottom: shouldShowLegend ? xAxisReservedBottom : undefined,
      show: shouldShowLegend,
      textStyle: {
        fontSize: compact ? 10 : 12,
        color: '#4a5568'
      },
      itemGap: compact ? 15 : 20,
      itemWidth: 14,
      itemHeight: 14,
      // 水平居中
      left: 'center',
      orient: 'horizontal'
    };
    const legendOption: any = {
      ...defaultLegendOption,
      ...(config.legend ?? {})
    };

    const defaultGridOption: any = {
      left: '5%',
      right: '5%',
      // 动态为 X 轴多行 label + legend 预留空间，避免重叠
      bottom: gridBottomFinal,
      top: '10%',
      containLabel: true
    };
    const gridOption: any = {
      ...defaultGridOption,
      ...(config.grid ?? {})
    };

    const baseOption: any = {
      backgroundColor: 'transparent',
      color: colorPalette,
      title: {
        text: config.title || '',
        left: 'center',
        textStyle: {
          fontSize: 18,
          fontWeight: 'bold',
          color: '#1a202c'
        },
        padding: [10, 0]
      },
      tooltip: config.tooltip || {
        trigger: 'axis',
        backgroundColor: 'rgba(50, 50, 50, 0.95)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: {
          color: '#fff',
          fontSize: 12
        },
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: '#718096'
          },
          lineStyle: {
            type: 'dashed',
            width: 1
          }
        },
        padding: [8, 12]
      },
      legend: legendOption,
      grid: gridOption,
      xAxis: {
        ...config.xAxis,
        type: 'category',
        data: xAxisData,
        name: config.xAxis?.name || (compact ? '' : 'X轴'),
        // 默认放中间，避免右侧被 grid 裁剪导致显示不全（如“支…”）
        nameLocation: config.xAxis?.nameLocation ?? 'middle',
        nameGap: config.xAxis?.nameGap ?? effectiveXAxisNameGap,
        nameTextStyle: {
          fontSize: 12,
          color: '#4a5568',
          padding: [8, 0, 0, 0],
          ...(config.xAxis?.nameTextStyle || {})
        },
        axisLine: {
          lineStyle: {
            color: '#e2e8f0',
            width: 1
          }
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: '#e2e8f0'
          }
        },
        splitLine: {
          show: false
        },
        // 对于日期数据保持原样；对长文本默认“换行展示全量”，避免总是显示不全
        axisLabel: (() => {
          const axisLabelFromConfig = config.xAxis?.axisLabel || {};
          const defaultFormatter = (value: unknown) => {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value;
            if (typeof value === 'string' && value.length > 10) {
              // 面板太矮时优先省略号，避免多行换行把图“压扁”
              if (compact) return value.slice(0, 10) + '…';
              const chunks = value.match(/.{1,6}/g);
              return chunks ? chunks.join('\n') : value;
            }
            return value as any;
          };

          return {
            show: axisLabelFromConfig.show ?? !veryCompact,
            margin: effectiveAxisLabelMargin,
            fontSize: effectiveAxisLabelFontSize,
            color: '#4a5568',
            ...axisLabelFromConfig,
            // 用户自定义 formatter 优先
            formatter: axisLabelFromConfig.formatter ?? defaultFormatter,
            rotate: axisLabelFromConfig.rotate ?? 0
          };
        })()
      },
      yAxis: {
        ...config.yAxis,
        type: 'value',
        name: config.yAxis?.name || (compact ? '' : 'Y轴'),
        nameTextStyle: {
          fontSize: 12,
          color: '#4a5568',
          padding: [0, 0, 8, 0]
        },
        axisLine: {
          show: true,
          lineStyle: {
            color: '#e2e8f0',
            width: 1
          }
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: '#e2e8f0'
          }
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#f1f5f9',
            type: 'dashed',
            width: 1
          }
        },
        axisLabel: {
          fontSize: 11,
          color: '#4a5568'
        }
      },
      animation: true,
      animationDuration: 750,
      animationEasing: 'cubicOut'
    };

    // 根据图表类型调整配置
    switch (config.type.toLowerCase()) {
      case 'bar':
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          data: sortedData.map(item => item[field] || 0),
          barWidth: '60%',
          barMaxWidth: 40,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
              ]
            }
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          },
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'line':
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: colorPalette[index % colorPalette.length]
          },
          emphasis: {
            focus: 'series'
          },
          ...(config.colorField ? {
            encode: { x: config.xField, y: field }
          } : {})
        }));
        break;
        
      case 'area':
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'line',
          data: sortedData.map(item => item[field] || 0),
          smooth: true,
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: colorPalette[index % colorPalette.length]
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] + 'CC' },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '20' }
              ]
            }
          },
          emphasis: {
            focus: 'series'
          },
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
            center: ['50%', '50%'],
            data: sortedData.map((item, index) => ({
              name: item[xField] || `数据${index + 1}`,
              value: item[fieldValue] || 0,
              itemStyle: {
                borderRadius: 6,
                borderColor: '#fff',
                borderWidth: 2
              }
            })),
            label: {
              show: true,
              formatter: '{b}: {c} ({d}%)',
              fontSize: 11,
              color: '#666'
            },
            labelLine: {
              show: true,
              lineStyle: {
                color: '#999'
              }
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 15,
                shadowOffsetX: 0,
                shadowOffsetY: 0,
                shadowColor: 'rgba(0, 0, 0, 0.4)'
              },
              label: {
                fontSize: 13,
                fontWeight: 'bold'
              }
            },
            animationType: 'scale',
            animationEasing: 'elasticOut',
            animationDelay: function (idx: number) {
              return idx * 50;
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
            data: sortedData.map(item => [item[yFields[0]] || 0, item[yFields[1]] || 0]),
            symbolSize: function(data: number[]) {
              return Math.sqrt(data[0] + data[1]) * 2 + 8;
            },
            itemStyle: {
              color: colorPalette[0],
              opacity: 0.7,
              borderColor: '#fff',
              borderWidth: 1
            },
            emphasis: {
              itemStyle: {
                opacity: 1,
                shadowBlur: 10,
                shadowColor: 'rgba(0, 0, 0, 0.3)'
              }
            }
          }];
          // 移除不必要的轴配置
          delete baseOption.xAxis.data;
          delete baseOption.xAxis.name;
          delete baseOption.yAxis.name;
        }
        break;
        
      case 'radar':
        // 雷达图配置
        const indicator = yFields.map(field => ({
          name: field,
          max: Math.max(...data.map(item => item[field] || 0)) * 1.1
        }));
        
        baseOption.radar = {
          indicator: indicator,
          shape: 'polygon',
          splitNumber: 5,
          radius: '70%',
          axisName: {
            color: '#666',
            fontSize: 12,
            fontWeight: 'normal'
          },
          splitArea: {
            show: true,
            areaStyle: {
              color: ['rgba(84, 112, 198, 0.05)', 'rgba(84, 112, 198, 0.1)']
            }
          },
          splitLine: {
            lineStyle: {
              color: '#e0e0e0',
              width: 1
            }
          },
          axisLine: {
            lineStyle: {
              color: '#e0e0e0',
              width: 1
            }
          }
        };
        
        baseOption.series = [{
          type: 'radar',
          data: [{
            value: yFields.map(field => data[0]?.[field] || 0),
            name: '数据',
            areaStyle: {
              color: colorPalette[0] + '40'
            },
            lineStyle: {
              width: 2.5,
              color: colorPalette[0]
            },
            itemStyle: {
              color: colorPalette[0],
              borderWidth: 2,
              borderColor: '#fff'
            },
            emphasis: {
              areaStyle: {
                color: colorPalette[0] + '60'
              }
            }
          }]
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'boxplot':
        // 箱线图需要特殊的数据格式
        baseOption.series = [{
          name: '箱线图',
          type: 'boxplot',
          data: sortedData.map((item, index) => {
            // 箱线图需要5个值：[min, Q1, median, Q3, max]
            const values = yFields.map(field => item[field] || 0).sort((a, b) => a - b);
            if (values.length >= 5) {
              return values.slice(0, 5);
            } else {
              // 如果数据不足5个，补充数据
              const median = values[Math.floor(values.length / 2)] || 0;
              const q1 = values[Math.floor(values.length / 4)] || median;
              const q3 = values[Math.floor(values.length * 3 / 4)] || median;
              const min = Math.min(...values) || 0;
              const max = Math.max(...values) || 0;
              return [min, q1, median, q3, max];
            }
          })
        }];
        
        baseOption.xAxis = {
          type: 'category',
          data: data.map((_, index) => `组${index + 1}`)
        };
        
        baseOption.yAxis = {
          type: 'value'
        };
        break;
        
      case 'stacked_bar':
        // 堆积柱形图
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          stack: '总量',
          data: sortedData.map(item => item[field] || 0),
          barWidth: '60%',
          barMaxWidth: 40,
          itemStyle: {
            borderRadius: index === yFields.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + 'CC' }
              ]
            }
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }));
        break;
        
      case 'waterfall':
        // 瀑布图 - 需要计算累积值
        let cumulative = 0;
        const waterfallData = sortedData.map((item, index) => {
          const value = item[yFields[0]] || 0;
          const result = cumulative + value;
          cumulative = result;
          return {
            name: item[xField] || `项目${index + 1}`,
            value: value,
            cumulative: result
          };
        });
        
        baseOption.series = [{
          name: '瀑布图',
          type: 'bar',
          data: waterfallData.map(item => ({
            value: item.value,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: item.value >= 0 ? '#5470c6' : '#ee6666' },
                  { offset: 1, color: (item.value >= 0 ? '#5470c6' : '#ee6666') + 'CC' }
                ]
              }
            }
          })),
          barWidth: '60%',
          barMaxWidth: 40,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }];
        
        // 添加辅助线显示累计值
        baseOption.series.push({
          name: '累计值',
          type: 'line',
          data: waterfallData.map(item => item.cumulative),
          symbol: 'none',
          showSymbol: false,
          lineStyle: {
            type: 'dashed',
            width: 2,
            color: '#999'
          },
          itemStyle: { color: '#999' }
        });
        break;
        
      case 'funnel':
        // 漏斗图
        const maxFunnelValue = Math.max(...sortedData.map(item => item[yFields[0]] || 0));
        baseOption.series = [{
          name: '漏斗图',
          type: 'funnel',
          left: '10%',
          top: 60,
          bottom: 60,
          width: '80%',
          min: 0,
          max: maxFunnelValue,
          minSize: '0%',
          maxSize: '100%',
          sort: 'descending',
          gap: 3,
          label: {
            show: true,
            position: 'inside',
            fontSize: 12,
            color: '#fff',
            fontWeight: 'bold',
            formatter: '{b}\n{c} ({d}%)'
          },
          labelLine: {
            show: true,
            length: 15,
            lineStyle: {
              width: 1,
              type: 'solid',
              color: '#999'
            }
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 2,
            borderRadius: 4
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            },
            label: {
              fontSize: 14
            }
          },
          data: sortedData.map((item, index) => ({
            name: item[xField] || `阶段${index + 1}`,
            value: item[yFields[0]] || 0,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: colorPalette[index % colorPalette.length] },
                  { offset: 1, color: colorPalette[index % colorPalette.length] + 'CC' }
                ]
              }
            }
          }))
        }];
        
        // 删除坐标轴配置
        delete baseOption.xAxis;
        delete baseOption.yAxis;
        break;
        
      case 'heatmap':
        // 热力图需要特殊的二维数据格式
        const maxValue = Math.max(...data.map(item => Math.max(...yFields.map(field => item[field] || 0))));
        baseOption.visualMap = {
          min: 0,
          max: maxValue,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '15%',
          inRange: {
            color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffcc', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
          },
          textStyle: {
            color: '#666',
            fontSize: 11
          },
          itemWidth: 15,
          itemHeight: 150
        };
        baseOption.series = [{
          name: '热力图',
          type: 'heatmap',
          data: sortedData.map((item, rowIndex) => 
            yFields.map((field, colIndex) => [colIndex, rowIndex, item[field] || 0])
          ).flat(),
          label: {
            show: true,
            fontSize: 10,
            color: '#333'
          },
          itemStyle: {
            borderColor: '#fff',
            borderWidth: 1
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
              borderWidth: 2
            }
          }
        }];
        baseOption.xAxis = {
          type: 'category',
          data: yFields,
          splitArea: {
            show: true
          },
          axisLabel: {
            fontSize: 11,
            color: '#666'
          }
        };
        baseOption.yAxis = {
          type: 'category',
          data: xAxisData,
          splitArea: {
            show: true
          },
          axisLabel: {
            fontSize: 11,
            color: '#666'
          }
        };
        break;
        
      default:
        // 默认使用柱状图
        baseOption.series = yFields.map((field, index) => ({
          name: field,
          type: 'bar',
          data: sortedData.map(item => item[field] || 0),
          barWidth: '60%',
          barMaxWidth: 40,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colorPalette[index % colorPalette.length] },
                { offset: 1, color: colorPalette[index % colorPalette.length] + '80' }
              ]
            }
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'rgba(0, 0, 0, 0.3)'
            }
          }
        }));
    }

    // 如果有颜色分组字段，添加颜色映射
    if (config.colorField && config.colorField !== '') {
      baseOption.visualMap = {
        show: false,
        dimension: 2,
        pieces: [
          { gt: 0, color: colorPalette[0] },
          { gt: 100, color: colorPalette[1] },
          { gt: 200, color: colorPalette[2] },
          { gt: 300, color: colorPalette[3] },
          { gt: 400, color: colorPalette[4] }
        ]
      };
    }

    return baseOption;
  }, [config, data, containerSize.height, containerSize.width]);

  // When parent controls height via percentages (e.g. dashboard cards), a large default minHeight
  // can cause ECharts to be clipped (overflow hidden) instead of adapting to the smaller container.
  const styleHeight = style?.height;
  const defaultMinHeight =
    typeof styleHeight === 'string' && styleHeight.trim().endsWith('%') ? 0 : 280;
  const resolvedMinHeight =
    (minHeight ??
      config.minHeight ??
      (typeof style.minHeight === 'number' ? style.minHeight : undefined) ??
      defaultMinHeight);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: resolvedMinHeight, ...style }}
    >
      {isReady ? (
        <ReactECharts
          ref={chartRef}
          option={option}
          notMerge={false}
          lazyUpdate={true}
          style={{ height: '100%' }}
          onEvents={onEvents}
        />
      ) : null}
    </div>
  );
};