/**
 * InsertColumnModal - 插入新列配置弹窗
 * 支持7种方法：计算列、分列、函数、查找替换、排名、分类分组、区间提取
 */
import React, { useState, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Table,
  Space,
  Card,
  Typography,
  Divider,
  Alert,
  Tooltip,
  Tag,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ScissorOutlined,
  FunctionOutlined,
  SwapOutlined,
  SortAscendingOutlined,
  FolderOutlined,
  BarChartOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

export interface InsertedColumnConfig {
  /** 编辑时的唯一标识 */
  id?: string;
  name: string;
  method: InsertedColumnMethod;
  sourceColumn: string;
  config: Record<string, unknown>;
}

export type InsertedColumnMethod = 'calculation' | 'split' | 'function' | 'lookup' | 'rank' | 'category' | 'bin';

export interface InsertColumnModalProps {
  visible: boolean;
  columns: string[];
  /** 要编辑的已有配置（传入则弹窗标题变为「编辑列」） */
  editConfig?: InsertedColumnConfig;
  onCancel: () => void;
  /** 新增或更新 */
  onConfirm: (config: InsertedColumnConfig) => void;
  /** 仅编辑模式下可用：删除该列 */
  onDelete?: (configId: string) => void;
}

/** 编辑模式下仅当前 method 带入已保存的 config，供子表单初始化（避免子表单 mount 时用空值覆盖父级 formValues） */
function initialConfigForMethod(
  method: InsertedColumnMethod,
  editConfig?: InsertedColumnConfig,
): Record<string, unknown> {
  if (editConfig?.method === method) {
    return { ...(editConfig.config ?? {}) };
  }
  return {};
}

/** 切换 Tab 再回来时，父级 formValues 里可能仍有 ranges；与 edit 初始合并，避免 destroyInactiveTabPane 卸载后丢区间 */
function mergeCategoryInitialConfig(
  editConfig: InsertedColumnConfig | undefined,
  formValues: Record<string, unknown>,
): Record<string, unknown> {
  const base = initialConfigForMethod('category', editConfig);
  const next: Record<string, unknown> = { ...base };
  if (Array.isArray(formValues.ranges)) {
    next.ranges = formValues.ranges;
  }
  if (formValues.default_label != null) {
    next.default_label = formValues.default_label;
  }
  return next;
}

// 计算列配置
interface CalculationFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
}

const CalculationForm: React.FC<CalculationFormProps> = ({ columns, onValuesChange, initialConfig }) => {
  const [expression, setExpression] = useState(() => String(initialConfig?.expression ?? ''));
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    const cfg = initialConfig ?? {};
    setExpression(String(cfg.expression ?? ''));
  }, [initSig]);

  useEffect(() => {
    onValuesChange({ expression });
  }, [expression, onValuesChange]);

  const insertColumn = (col: string) => {
    setExpression((prev) => prev + ` ${col} `);
  };

  return (
    <div>
      <Alert
        message="使用说明"
        description="在表达式中使用列名，点击列名按钮可快速插入。支持加减乘除运算符: + - * / ( )"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="表达式">
          <TextArea
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            rows={4}
            placeholder="例如: (销售额 + 税额) * 0.9"
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>
        <Form.Item label="插入列名到表达式">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {columns.map((col) => (
              <Tag
                key={col}
                onClick={() => insertColumn(col)}
                style={{ cursor: 'pointer' }}
                color="blue"
              >
                {col}
              </Tag>
            ))}
          </div>
        </Form.Item>
        <Form.Item label="运算符">
          <Space>
            {['+', '-', '*', '/', '(', ')'].map((op) => (
              <Button key={op} onClick={() => setExpression((prev) => prev + op)}>
                {op}
              </Button>
            ))}
            <Button onClick={() => setExpression((prev) => prev + ' MOD ')}>MOD</Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  );
};

// 分列配置
interface SplitFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
  sourceColumn?: string;
  onSourceColumnChange?: (col: string) => void;
}

const SplitForm: React.FC<SplitFormProps> = ({
  columns,
  onValuesChange,
  initialConfig,
  sourceColumn,
  onSourceColumnChange,
}) => {
  const parseSplitState = (cfg: Record<string, unknown>) => ({
    split_type: String(cfg.split_type ?? 'delimiter'),
    delimiter: String(cfg.delimiter ?? ','),
    regex: String(cfg.regex ?? ''),
    position: typeof cfg.position === 'number' && !Number.isNaN(cfg.position)
      ? cfg.position
      : Number(cfg.position) || 1,
  });

  const [values, setValues] = useState(() => parseSplitState(initialConfig ?? {}));
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    setValues(parseSplitState(initialConfig ?? {}));
  }, [initSig]);

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  return (
    <div>
      <Alert
        message="分列说明"
        description="按分隔符或正则表达式提取字符串的指定部分"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="源列">
          <Select
            value={sourceColumn || undefined}
            onChange={(v) => onSourceColumnChange?.(v)}
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择要分列的列"
            allowClear
          />
        </Form.Item>
        <Form.Item label="分列方式">
          <Select
            value={values.split_type}
            onChange={(v) => setValues((prev) => ({ ...prev, split_type: v }))}
            options={[
              { label: '分隔符', value: 'delimiter' },
              { label: '正则表达式', value: 'regex' },
              { label: '固定宽度', value: 'fixed' },
            ]}
          />
        </Form.Item>
        {values.split_type === 'delimiter' && (
          <Form.Item label="分隔符">
            <Input
              value={values.delimiter}
              onChange={(e) => setValues((prev) => ({ ...prev, delimiter: e.target.value }))}
              placeholder="如: , 或 | 或 \\t"
            />
          </Form.Item>
        )}
        {values.split_type === 'regex' && (
          <Form.Item label="正则表达式">
            <Input
              value={values.regex}
              onChange={(e) => setValues((prev) => ({ ...prev, regex: e.target.value }))}
              placeholder="如: \\d+ 提取数字"
            />
          </Form.Item>
        )}
        <Form.Item label="提取第几部分 (从1开始)">
          <InputNumber
            min={1}
            value={values.position}
            onChange={(v) => setValues((prev) => ({ ...prev, position: v || 1 }))}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>
            1=第一部分, -1=最后一部分
          </Text>
        </Form.Item>
      </Form>
    </div>
  );
};

// 函数配置
interface FunctionFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
  sourceColumn?: string;
  onSourceColumnChange?: (col: string) => void;
}

const FUNCTIONS = [
  { label: '字符串函数', options: [
    { label: 'CONCAT - 拼接字符串', value: 'CONCAT' },
    { label: 'SUBSTRING - 截取字符串', value: 'SUBSTRING' },
    { label: 'TRIM - 去除首尾空格', value: 'TRIM' },
    { label: 'LTRIM - 去除左侧空格', value: 'LTRIM' },
    { label: 'RTRIM - 去除右侧空格', value: 'RTRIM' },
    { label: 'UPPER - 转大写', value: 'UPPER' },
    { label: 'LOWER - 转小写', value: 'LOWER' },
    { label: 'LENGTH - 字符串长度', value: 'LENGTH' },
    { label: 'CHAR_LENGTH - 字符数', value: 'CHAR_LENGTH' },
  ]},
  { label: '数值函数', options: [
    { label: 'ROUND - 四舍五入', value: 'ROUND' },
    { label: 'ABS - 绝对值', value: 'ABS' },
    { label: 'FLOOR - 向下取整', value: 'FLOOR' },
    { label: 'CEIL - 向上取整', value: 'CEIL' },
  ]},
  { label: '日期函数', options: [
    { label: 'YEAR - 提取年份', value: 'YEAR' },
    { label: 'MONTH - 提取月份', value: 'MONTH' },
    { label: 'DAY - 提取日期', value: 'DAY' },
    { label: 'DATE - 转为日期', value: 'DATE' },
    { label: 'DATE_FORMAT - 日期格式化', value: 'DATE_FORMAT' },
  ]},
  { label: '逻辑函数', options: [
    { label: 'IF - 条件判断', value: 'IF' },
    { label: 'COALESCE - 返回首个非空值', value: 'COALESCE' },
    { label: 'CAST - 类型转换', value: 'CAST' },
  ]},
];

function parseFunctionFormState(cfg: Record<string, unknown>) {
  const rawArgs = cfg.arguments;
  const arr = Array.isArray(rawArgs) ? rawArgs.map((a) => String(a ?? '')) : [];
  const args = arr.length > 0 ? arr : [''];
  return {
    function_name: String(cfg.function_name ?? ''),
    arguments: args,
    extraArg: '',
  };
}

const FunctionForm: React.FC<FunctionFormProps> = ({
  columns,
  onValuesChange,
  initialConfig,
  sourceColumn,
  onSourceColumnChange,
}) => {
  const [values, setValues] = useState(() => parseFunctionFormState(initialConfig ?? {}));
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    setValues(parseFunctionFormState(initialConfig ?? {}));
  }, [initSig]);

  useEffect(() => {
    const args = values.arguments.filter((a) => a !== '');
    onValuesChange({
      function_name: values.function_name,
      arguments: [...args, values.extraArg].filter((a) => a !== ''),
    });
  }, [values, onValuesChange]);

  const addArg = () => {
    setValues((prev) => ({ ...prev, arguments: [...prev.arguments, ''] }));
  };

  const updateArg = (index: number, value: string) => {
    setValues((prev) => {
      const newArgs = [...prev.arguments];
      newArgs[index] = value;
      return { ...prev, arguments: newArgs };
    });
  };

  return (
    <div>
      <Alert
        message="函数说明"
        description="选择函数并配置参数，部分参数可选择列名"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="源列（部分函数以列为输入）">
          <Select
            value={sourceColumn || undefined}
            onChange={(v) => onSourceColumnChange?.(v)}
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择源列"
            allowClear
          />
        </Form.Item>
        <Form.Item label="函数">
          <Select
            showSearch
            options={FUNCTIONS}
            value={values.function_name || undefined}
            onChange={(v) => setValues((prev) => ({ ...prev, function_name: v }))}
            placeholder="选择函数"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="参数 (选择列或输入值)">
          {values.arguments.map((arg, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <Text type="secondary">参数 {index + 1}:</Text>
              <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                <Select
                  style={{ width: '50%' }}
                  options={columns.map((c) => ({ label: c, value: c }))}
                  value={columns.includes(arg) ? arg : undefined}
                  onChange={(v) => updateArg(index, v)}
                  placeholder="选择列"
                  allowClear
                />
                <Input
                  style={{ width: '50%' }}
                  value={columns.includes(arg) ? '' : arg}
                  onChange={(e) => updateArg(index, e.target.value)}
                  placeholder="或输入值"
                />
              </Space.Compact>
            </div>
          ))}
          {values.function_name === 'SUBSTRING' && values.arguments.length < 2 && (
            <Button type="dashed" onClick={addArg} icon={<PlusOutlined />}>
              添加参数
            </Button>
          )}
          {values.function_name === 'IF' && (
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              IF 语法: IF(条件, 真值, 假值)
            </Paragraph>
          )}
          {values.function_name === 'DATE_FORMAT' && (
            <Form.Item label="日期格式" style={{ marginTop: 8 }}>
              <Select
                options={[
                  { label: '%Y-%m-%d', value: '%Y-%m-%d' },
                  { label: '%Y-%m-%d %H:%i:%s', value: '%Y-%m-%d %H:%i:%s' },
                  { label: '%Y年%m月%d日', value: '%Y年%m月%d日' },
                  { label: '%m/%d/%Y', value: '%m/%d/%Y' },
                ]}
                placeholder="选择日期格式"
                onChange={(v) => setValues((prev) => ({ ...prev, extraArg: v }))}
              />
            </Form.Item>
          )}
        </Form.Item>
      </Form>
    </div>
  );
};

// 查找替换配置
interface LookupFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
  sourceColumn?: string;
  onSourceColumnChange?: (col: string) => void;
}

interface LookupItem {
  key: string;
  value: string;
}

function parseLookupState(cfg: Record<string, unknown>): { items: LookupItem[]; defaultValue: string } {
  const lt = cfg.lookup_table;
  const rows: LookupItem[] = Array.isArray(lt)
    ? lt.map((row: unknown) => {
        const r = row as Record<string, unknown>;
        return { key: String(r.key ?? ''), value: String(r.value ?? '') };
      })
    : [];
  return {
    items: rows.length > 0 ? rows : [{ key: '', value: '' }],
    defaultValue: String(cfg.default_value ?? ''),
  };
}

const LookupForm: React.FC<LookupFormProps> = ({
  columns,
  onValuesChange,
  initialConfig,
  sourceColumn,
  onSourceColumnChange,
}) => {
  const init = parseLookupState(initialConfig ?? {});
  const [items, setItems] = useState<LookupItem[]>(init.items);
  const [defaultValue, setDefaultValue] = useState(init.defaultValue);
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    const next = parseLookupState(initialConfig ?? {});
    setItems(next.items);
    setDefaultValue(next.defaultValue);
  }, [initSig]);

  useEffect(() => {
    onValuesChange({
      lookup_table: items.filter((i) => i.key !== ''),
      default_value: defaultValue,
    });
  }, [items, defaultValue, onValuesChange]);

  const updateItem = (index: number, field: 'key' | 'value', val: string) => {
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: val };
      return newItems;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Alert
        message="查找替换说明"
        description="将源列中的值映射为新值，未匹配的值保持不变或使用默认值"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="源列">
          <Select
            value={sourceColumn || undefined}
            onChange={(v) => onSourceColumnChange?.(v)}
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择要查找替换的列"
            allowClear
          />
        </Form.Item>
        <Form.Item label="映射表">
          <Table
            size="small"
            pagination={false}
            dataSource={items.map((item, index) => ({ ...item, index }))}
            columns={[
              {
                title: '原值',
                dataIndex: 'key',
                width: '40%',
                render: (_, record) => (
                  <Input
                    value={record.key}
                    onChange={(e) => updateItem(record.index, 'key', e.target.value)}
                    placeholder="原值"
                  />
                ),
              },
              {
                title: '新值',
                dataIndex: 'value',
                width: '40%',
                render: (_, record) => (
                  <Input
                    value={record.value}
                    onChange={(e) => updateItem(record.index, 'value', e.target.value)}
                    placeholder="新值"
                  />
                ),
              },
              {
                title: '',
                width: '20%',
                render: (_, record) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeItem(record.index)}
                  />
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            onClick={addItem}
            icon={<PlusOutlined />}
            style={{ marginTop: 8, width: '100%' }}
          >
            添加映射
          </Button>
        </Form.Item>
        <Form.Item label="默认值 (未匹配时)">
          <Input
            value={defaultValue}
            onChange={(e) => setDefaultValue(e.target.value)}
            placeholder="留空则保持原值"
          />
        </Form.Item>
      </Form>
    </div>
  );
};

// 排名配置
interface RankFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
}

function parseRankState(cfg: Record<string, unknown>) {
  const pb = cfg.partition_by;
  const partition_by = Array.isArray(pb) ? pb.map(String) : [];
  const ob = cfg.order_by as Record<string, unknown> | undefined;
  const order_by =
    ob && typeof ob === 'object'
      ? {
          column: String(ob.column ?? ''),
          direction: String(ob.direction ?? 'desc') === 'asc' ? 'asc' : 'desc',
        }
      : { column: '', direction: 'desc' };
  const rt = String(cfg.rank_type ?? 'ROW_NUMBER');
  const rank_type = ['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(rt) ? rt : 'ROW_NUMBER';
  return { rank_type, partition_by, order_by };
}

const RankForm: React.FC<RankFormProps> = ({ columns, onValuesChange, initialConfig }) => {
  const [values, setValues] = useState(() => parseRankState(initialConfig ?? {}));
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    setValues(parseRankState(initialConfig ?? {}));
  }, [initSig]);

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  return (
    <div>
      <Alert
        message="排名说明"
        description="添加排名列，支持分组排名和多种排名方式"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="排名类型">
          <Select
            value={values.rank_type}
            onChange={(v) => setValues((prev) => ({ ...prev, rank_type: v }))}
            options={[
              { label: 'ROW_NUMBER - 连续排名', value: 'ROW_NUMBER' },
              { label: 'RANK - 并列跳跃', value: 'RANK' },
              { label: 'DENSE_RANK - 并列不跳跃', value: 'DENSE_RANK' },
            ]}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            ROW_NUMBER: 1,2,3 | RANK: 1,1,3 | DENSE_RANK: 1,1,2
          </Text>
        </Form.Item>
        <Form.Item label="分区字段 (可选，不选则为全局排名)">
          <Select
            mode="multiple"
            options={columns.map((c) => ({ label: c, value: c }))}
            value={values.partition_by}
            onChange={(v) => setValues((prev) => ({ ...prev, partition_by: v }))}
            placeholder="选择分区字段"
            allowClear
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            按哪些字段分组，同一组内独立排名
          </Text>
        </Form.Item>
        <Form.Item label="排序字段">
          <Space.Compact>
            <Select
              style={{ width: '60%' }}
              options={columns.map((c) => ({ label: c, value: c }))}
              value={values.order_by.column || undefined}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, order_by: { ...prev.order_by, column: v } }))
              }
              placeholder="选择排序字段"
            />
            <Select
              style={{ width: '40%' }}
              value={values.order_by.direction}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, order_by: { ...prev.order_by, direction: v } }))
              }
              options={[
                { label: '降序 (大在前)', value: 'desc' },
                { label: '升序 (小在前)', value: 'asc' },
              ]}
            />
          </Space.Compact>
        </Form.Item>
      </Form>
    </div>
  );
};

// 分类分组配置
interface CategoryFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
  sourceColumn?: string;
  onSourceColumnChange?: (col: string) => void;
}

interface RangeItem {
  from: number | null;
  to: number | null;
  label: string;
  includeTo: boolean; // true: 包含结束值 [from, to]; false: 不包含结束值 [from, to)
}

function parseCategoryState(cfg: Record<string, unknown>): {
  ranges: RangeItem[];
  defaultLabel: string;
} {
  const raw = cfg.ranges;
  const ranges: RangeItem[] = Array.isArray(raw)
    ? raw.map((r: unknown) => {
        const x = r as Record<string, unknown>;
        return {
          from: typeof x.from === 'number' ? x.from : x.from != null ? Number(x.from) : null,
          to: typeof x.to === 'number' ? x.to : x.to != null ? Number(x.to) : null,
          label: String(x.label ?? ''),
          includeTo: x.includeTo === true || x.include_to === true,
        };
      })
    : [];
  return {
    ranges: ranges.length > 0 ? ranges : [{ from: null, to: null, label: '', includeTo: false }],
    defaultLabel: String(cfg.default_label ?? '其他'),
  };
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  columns,
  onValuesChange,
  initialConfig,
  sourceColumn,
  onSourceColumnChange,
}) => {
  const init = parseCategoryState(initialConfig ?? {});
  const [ranges, setRanges] = useState<RangeItem[]>(init.ranges);
  const [defaultLabel, setDefaultLabel] = useState(init.defaultLabel);
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    const next = parseCategoryState(initialConfig ?? {});
    setRanges(next.ranges);
    setDefaultLabel(next.defaultLabel);
  }, [initSig]);

  useEffect(() => {
    onValuesChange({
      ranges: ranges.filter((r) => r.label !== ''),
      default_label: defaultLabel,
    });
  }, [ranges, defaultLabel, onValuesChange]);

  const updateRange = (index: number, field: keyof RangeItem, value: unknown) => {
    setRanges((prev) => {
      const newRanges = [...prev];
      newRanges[index] = { ...newRanges[index], [field]: value };
      return newRanges;
    });
  };

  const addRange = () => {
    setRanges((prev) => [...prev, { from: null, to: null, label: '', includeTo: false }]);
  };

  const removeRange = (index: number) => {
    setRanges((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Alert
        message="分类分组说明"
        description="将数值划分到不同的类别区间，为每个区间设置标签。通过「包含结束值」开关可自由选择结束值是否包含：开启时为 [起始值, 结束值]，关闭时为 [起始值, 结束值)。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="源列 (数值列)">
          <Select
            value={sourceColumn || undefined}
            onChange={(v) => onSourceColumnChange?.(v)}
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择数值列"
            allowClear
          />
        </Form.Item>
        <Form.Item label="区间配置">
          <Table
            size="small"
            pagination={false}
            dataSource={ranges.map((r, i) => ({ ...r, index: i }))}
            columns={[
              {
                title: '起始值 (包含)',
                dataIndex: 'from',
                width: '20%',
                render: (_, record) => (
                  <InputNumber
                    value={record.from ?? undefined}
                    onChange={(v) => updateRange(record.index, 'from', v)}
                    placeholder="从"
                    style={{ width: '100%' }}
                    controls={false}
                  />
                ),
              },
              {
                title: '结束值',
                dataIndex: 'to',
                width: '20%',
                render: (_, record) => (
                  <InputNumber
                    value={record.to ?? undefined}
                    onChange={(v) => updateRange(record.index, 'to', v)}
                    placeholder="到"
                    style={{ width: '100%' }}
                    controls={false}
                  />
                ),
              },
              {
                title: '包含结束值',
                dataIndex: 'includeTo',
                width: '15%',
                render: (_, record) => (
                  <Switch
                    checked={record.includeTo}
                    onChange={(checked) => updateRange(record.index, 'includeTo', checked)}
                    checkedChildren="包含"
                    unCheckedChildren="不包含"
                    size="small"
                  />
                ),
              },
              {
                title: '标签',
                dataIndex: 'label',
                width: '30%',
                render: (_, record) => (
                  <Input
                    value={record.label}
                    onChange={(e) => updateRange(record.index, 'label', e.target.value)}
                    placeholder="标签名"
                  />
                ),
              },
              {
                title: '',
                width: '15%',
                render: (_, record) => (
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeRange(record.index)}
                  />
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            onClick={addRange}
            icon={<PlusOutlined />}
            style={{ marginTop: 8, width: '100%' }}
          >
            添加区间
          </Button>
        </Form.Item>
        <Form.Item label="默认值 (未匹配时)">
          <Input
            value={defaultLabel}
            onChange={(e) => setDefaultLabel(e.target.value)}
            placeholder="默认标签"
          />
        </Form.Item>
      </Form>
    </div>
  );
};

// 区间提取配置
interface BinFormProps {
  columns: string[];
  onValuesChange: (values: Record<string, unknown>) => void;
  initialConfig?: Record<string, unknown>;
  sourceColumn?: string;
  onSourceColumnChange?: (col: string) => void;
}

function parseBinState(cfg: Record<string, unknown>) {
  const bt = String(cfg.bin_type ?? 'fixed');
  const bin_type = bt === 'custom' ? 'custom' : 'fixed';
  const bin_size =
    typeof cfg.bin_size === 'number' && !Number.isNaN(cfg.bin_size)
      ? cfg.bin_size
      : Number(cfg.bin_size) || 10;
  const cb = cfg.custom_bins;
  const custom_bins = Array.isArray(cb)
    ? cb.map((n) => Number(n)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    : [];
  return { bin_type, bin_size, custom_bins };
}

const BinForm: React.FC<BinFormProps> = ({
  columns,
  onValuesChange,
  initialConfig,
  sourceColumn,
  onSourceColumnChange,
}) => {
  const [values, setValues] = useState(() => parseBinState(initialConfig ?? {}));
  const initSig = JSON.stringify(initialConfig ?? {});

  useEffect(() => {
    setValues(parseBinState(initialConfig ?? {}));
  }, [initSig]);

  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  const generateBins = (size: number, count: number) => {
    return Array.from({ length: count }, (_, i) => i * size);
  };

  return (
    <div>
      <Alert
        message="区间提取说明"
        description="将连续数值离散化为固定大小的区间"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form layout="vertical">
        <Form.Item label="源列 (数值列)">
          <Select
            value={sourceColumn || undefined}
            onChange={(v) => onSourceColumnChange?.(v)}
            options={columns.map((c) => ({ label: c, value: c }))}
            placeholder="选择数值列"
            allowClear
          />
        </Form.Item>
        <Form.Item label="区间类型">
          <Select
            value={values.bin_type}
            onChange={(v) => setValues((prev) => ({ ...prev, bin_type: v }))}
            options={[
              { label: '固定区间大小', value: 'fixed' },
              { label: '自定义区间边界', value: 'custom' },
            ]}
          />
        </Form.Item>
        {values.bin_type === 'fixed' && (
          <>
            <Form.Item label="区间大小">
              <InputNumber
                value={values.bin_size}
                onChange={(v) => setValues((prev) => ({ ...prev, bin_size: v || 10 }))}
                min={0.01}
                style={{ width: 200 }}
              />
              <Text type="secondary" style={{ marginLeft: 8 }}>
                如: 10 → 0, 10, 20, 30...
              </Text>
            </Form.Item>
            <Form.Item label="快速生成">
              <Space>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 5 }))}>5</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 10 }))}>10</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 50 }))}>50</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 100 }))}>100</Button>
                <Button onClick={() => setValues((prev) => ({ ...prev, bin_size: 1000 }))}>1000</Button>
              </Space>
            </Form.Item>
          </>
        )}
        {values.bin_type === 'custom' && (
          <>
            <Form.Item label="自定义边界">
              <Select
                mode="tags"
                value={values.custom_bins.map(String)}
                onChange={(v) =>
                  setValues((prev) => ({
                    ...prev,
                    custom_bins: v.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b),
                  }))
                }
                placeholder="输入边界值，如: 0, 1000, 5000, 10000"
                tokenSeparators={[',']}
              />
              <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                输入用逗号分隔的数字，如: 0, 1000, 5000, 10000
              </Text>
            </Form.Item>
            <Form.Item label="预设">
              <Space direction="vertical">
                <Space>
                  <Button onClick={() => setValues((prev) => ({ ...prev, custom_bins: generateBins(1000, 11) }))}>
                    1000 为区间
                  </Button>
                  <Button onClick={() => setValues((prev) => ({ ...prev, custom_bins: generateBins(100, 11) }))}>
                    100 为区间
                  </Button>
                </Space>
              </Space>
            </Form.Item>
          </>
        )}
      </Form>
    </div>
  );
};

// 主组件
export const InsertColumnModal: React.FC<InsertColumnModalProps> = ({
  visible,
  columns,
  editConfig,
  onCancel,
  onConfirm,
  onDelete,
}) => {
  const isEdit = !!editConfig;
  const [activeTab, setActiveTab] = useState<InsertedColumnMethod>(editConfig?.method ?? 'calculation');
  const [formValues, setFormValues] = useState<Record<string, unknown>>(editConfig?.config ?? {});
  const [newColumnName, setNewColumnName] = useState(editConfig?.name ?? '');
  const [sourceColumn, setSourceColumn] = useState<string | undefined>(editConfig?.sourceColumn);
  const [form] = Form.useForm();

  const handleValuesChange = useCallback((values: Record<string, unknown>) => {
    setFormValues((prev) => ({ ...prev, ...values }));
  }, []);

  const handleConfirm = useCallback(() => {
    if (!newColumnName.trim()) {
      return;
    }
    onConfirm({
      ...(editConfig?.id ? { id: editConfig.id } : {}),
      name: newColumnName,
      method: activeTab as InsertedColumnConfig['method'],
      sourceColumn: sourceColumn || columns[0] || '',
      config: formValues,
    });
  }, [newColumnName, editConfig, activeTab, sourceColumn, columns, formValues, onConfirm]);

  const resetForm = useCallback(() => {
    setNewColumnName('');
    setSourceColumn(undefined);
    setFormValues({});
    setActiveTab('calculation');
  }, []);

  // 打开/关闭弹窗或与 editConfig 同步时，在绘制子表单前写入父级状态，避免子表单 mount 用空值覆盖已加载的配置
  useLayoutEffect(() => {
    if (!visible) {
      setNewColumnName('');
      setSourceColumn(undefined);
      setFormValues({});
      setActiveTab('calculation');
      form.resetFields();
      return;
    }
    if (editConfig) {
      setNewColumnName(editConfig.name);
      setSourceColumn(editConfig.sourceColumn);
      setFormValues(editConfig.config ?? {});
      setActiveTab(editConfig.method);
    } else {
      setNewColumnName('');
      setSourceColumn(undefined);
      setFormValues({});
      setActiveTab('calculation');
    }
  }, [visible, editConfig]); // 移除 form 依赖，避免循环更新

  const categoryRanges = formValues.ranges;
  const categoryDefaultLabel = formValues.default_label;
  const categoryFormInitial = useMemo(
    () =>
      mergeCategoryInitialConfig(editConfig, {
        ranges: categoryRanges,
        default_label: categoryDefaultLabel,
      }),
    [editConfig, categoryRanges, categoryDefaultLabel],
  );

  const tabItems: Array<{ key: InsertedColumnMethod; label: React.ReactNode; children: React.ReactNode }> = useMemo(
    () => [
      {
        key: 'calculation',
        label: (
          <span>
            <CalculatorOutlined /> 计算
          </span>
        ),
        children: (
          <CalculationForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('calculation', editConfig)}
          />
        ),
      },
      {
        key: 'split',
        label: (
          <span>
            <ScissorOutlined /> 分列
          </span>
        ),
        children: (
          <SplitForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('split', editConfig)}
            sourceColumn={sourceColumn}
            onSourceColumnChange={setSourceColumn}
          />
        ),
      },
      {
        key: 'function',
        label: (
          <span>
            <FunctionOutlined /> 函数
          </span>
        ),
        children: (
          <FunctionForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('function', editConfig)}
            sourceColumn={sourceColumn}
            onSourceColumnChange={setSourceColumn}
          />
        ),
      },
      {
        key: 'lookup',
        label: (
          <span>
            <SwapOutlined /> 查找替换
          </span>
        ),
        children: (
          <LookupForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('lookup', editConfig)}
            sourceColumn={sourceColumn}
            onSourceColumnChange={setSourceColumn}
          />
        ),
      },
      {
        key: 'rank',
        label: (
          <span>
            <SortAscendingOutlined /> 排名
          </span>
        ),
        children: (
          <RankForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('rank', editConfig)}
          />
        ),
      },
      {
        key: 'category',
        label: (
          <span>
            <FolderOutlined /> 分类分组
          </span>
        ),
        children: (
          <CategoryForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={categoryFormInitial}
            sourceColumn={sourceColumn}
            onSourceColumnChange={setSourceColumn}
          />
        ),
      },
      {
        key: 'bin',
        label: (
          <span>
            <BarChartOutlined /> 区间提取
          </span>
        ),
        children: (
          <BinForm
            columns={columns}
            onValuesChange={handleValuesChange}
            initialConfig={initialConfigForMethod('bin', editConfig)}
            sourceColumn={sourceColumn}
            onSourceColumnChange={setSourceColumn}
          />
        ),
      },
    ],
    [columns, handleValuesChange, editConfig, sourceColumn, categoryFormInitial],
  );

  return (
    <Modal
      title={
        <span>
          <PlusOutlined style={{ marginRight: 8 }} />
          {isEdit ? '编辑列' : '插入新列'}
        </span>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText={isEdit ? '保存修改' : '确认添加'}
      cancelText="取消"
      width={700}
      destroyOnClose
      footer={
        isEdit && onDelete && editConfig?.id ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button danger onClick={() => { onDelete(editConfig.id!); onCancel(); }}>
              删除此列
            </Button>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" onClick={handleConfirm}>保存修改</Button>
            </Space>
          </div>
        ) : (
          undefined
        )
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="新列名"
          required
          validateStatus={newColumnName.trim() ? 'success' : 'error'}
          help={!newColumnName.trim() ? '请输入新列名' : ''}
        >
          <Input
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            placeholder="输入新列名"
            style={{ width: 300 }}
          />
        </Form.Item>
      </Form>

      <Divider>选择生成方式</Divider>

      <Tabs
        destroyInactiveTabPane
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as InsertedColumnMethod)}
        items={tabItems}
        tabPosition="left"
        style={{ minHeight: 400 }}
      />
    </Modal>
  );
};

export default InsertColumnModal;
