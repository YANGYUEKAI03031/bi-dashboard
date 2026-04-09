# Pipeline 数据变更自动触发 — 实施方案

## 一、核心思路

在现有增量机制基础上，新增**触发调度层**：定时轮询源表高水位，对比最新数据，有新数据时调用 `PipelineEngine.run()` 触发执行。完全复用现有 `PipelineWatermark` 和 `WatermarkManager`，前端扩展"自动触发"开关。

---

## 二、架构图

```mermaid
flowermaid
flowchart TD
    subgraph 调度层
        APScheduler["APScheduler\n定时触发（cron / interval）"]
        TriggerScheduler["TriggerScheduler.poll_all_triggers()"]
    end

    subgraph 数据库
        TriggerTable["pipeline_triggers 表\npipeline_id / source_table\nwatermark_field / cron_expr / interval_sec\nlast_watermark_value / last_check_at"]
        WatermarkTable["pipeline_watermarks 表\n（现有，增量水位）"]
        PipelineExecTable["pipeline_executions 表\n（现有，状态 tracking）"]
    end

    subgraph 数据源
        MySQLSource["MySQL 源表\norders / products ..."]
    end

    subgraph 执行层
        PipelineEngine["PipelineEngine.run()"]
    end

    subgraph 通知层[通知层（预留接口）]
        NotificationHook["NotificationHook.notify()\n可扩展：邮件 / 钉钉 / Webhook"]
    end

    APScheduler -->|"满足 cron / interval 条件"| TriggerScheduler
    TriggerScheduler --> TriggerTable
    TriggerTable -->|"SELECT MAX(watermark_field)\nFROM source_table"| MySQLSource
    MySQLSource -->|"MAX 值 > last_watermark"| TriggerScheduler
    TriggerScheduler --> PipelineExecTable
    PipelineExecTable -->|"检查 running 状态\n有运行中则排队"| TriggerScheduler
    TriggerScheduler -->|"无运行中 → 调用"| PipelineEngine
    TriggerScheduler -->|"有运行中 → 记录待触发\n下次轮询再执行"| TriggerTable["pipeline_trigger_queue 表\n（排队等待）"]
    TriggerScheduler -->|"触发成功后"| NotificationHook
    TriggerScheduler -->|"更新 last_watermark_value"| TriggerTable
```

---

## 三、实施步骤

### 步骤一：新增 `PipelineTrigger` 模型

**文件**: `backend/app/models/pipeline.py`

在现有 Model 后追加：

```python
class TriggerScheduleType(str, Enum):
    INTERVAL = "interval"   # 简单间隔（每 N 分钟/小时）
    CRON     = "cron"       # Cron 表达式（每日几点等）


class PipelineTrigger(SQLModel, table=True):
    __tablename__ = "pipeline_triggers"

    id: int = Field(default=None, primary_key=True)
    pipeline_id: int = Field(
        sa_column=Column(Integer, ForeignKey("data_pipelines.id"), index=True, unique=True)
    )

    # 监控目标
    source_table: str = Field(max_length=255)           # 监控的源表名
    watermark_field: str = Field(max_length=128)        # 高水位字段（updated_at / id）

    # 调度策略（两者二选一）
    schedule_type: TriggerScheduleType = Field(default=TriggerScheduleType.INTERVAL)
    # schedule_type = INTERVAL 时使用
    interval_seconds: int = Field(default=1800)         # 默认 30 分钟
    # schedule_type = CRON 时使用
    cron_expr: Optional[str] = Field(default=None, max_length=64)  # 如 "0 8 * * *" 表示每天 8:00

    enabled: bool = Field(default=True)
    last_check_at: Optional[datetime] = Field(default=None)
    last_watermark_value: Optional[str] = Field(default=None)

    created_by: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

> 设计说明：`pipeline_id` 与 `trigger` 为 **1:1 关系**（一个管道只能有一个触发器），所以用 `unique=True`。

### 排队表：`PipelineTriggerQueue`

**文件**: `backend/app/models/pipeline.py`

```python
class PipelineTriggerQueue(SQLModel, table=True):
    __tablename__ = "pipeline_trigger_queue"

    id: int = Field(default=None, primary_key=True)
    pipeline_id: int = Field(
        sa_column=Column(Integer, ForeignKey("data_pipelines.id"), index=True)
    )
    trigger_id: int = Field(
        sa_column=Column(Integer, ForeignKey("pipeline_triggers.id"), index=True)
    )
    watermark_value: str = Field(max_length=255)      # 待触发的水位值
    enqueued_at: datetime = Field(default_factory=datetime.utcnow)
    # 状态：pending / triggered / expired
    status: str = Field(default="pending")
    execution_id: Optional[int] = Field(default=None)
```

---

### 步骤二：新增 `NotificationHook` 通知接口（预留）

**文件**: `backend/app/services/notifications/notification_hook.py`（新建）

```python
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from datetime import datetime


class NotificationChannel(ABC):
    """通知渠道抽象基类，扩展时只需新增子类"""

    @property
    @abstractmethod
    def channel_name(self) -> str:
        """渠道名称，如 'email', 'dingtalk', 'webhook'"""
        pass

    @abstractmethod
    async def send(self, event: "PipelineTriggeredEvent") -> bool:
        """发送通知，返回是否成功"""
        pass


class PipelineTriggeredEvent:
    """触发事件数据"""
    def __init__(
        self,
        pipeline_id: int,
        pipeline_name: str,
        trigger_id: int,
        watermark_field: str,
        old_watermark: Optional[str],
        new_watermark: str,
        triggered_at: datetime,
        execution_id: Optional[int] = None,
    ):
        self.pipeline_id = pipeline_id
        self.pipeline_name = pipeline_name
        self.trigger_id = trigger_id
        self.watermark_field = watermark_field
        self.old_watermark = old_watermark
        self.new_watermark = new_watermark
        self.triggered_at = triggered_at
        self.execution_id = execution_id


class NotificationHook:
    """
    通知钩子聚合器。
    目前为空实现（不发送任何通知），后续在 notify() 中注册渠道即可。
    """

    def __init__(self):
        self._channels: list[NotificationChannel] = []

    def register(self, channel: NotificationChannel) -> None:
        self._channels.append(channel)

    async def notify(self, event: PipelineTriggeredEvent) -> None:
        """遍历所有已注册渠道发送通知，失败不影响主流程"""
        for channel in self._channels:
            try:
                await channel.send(event)
            except Exception as exc:
                logger.warning(f"通知渠道 [{channel.channel_name}] 发送失败: {exc}")
```

---

### 步骤三：新增 `TriggerScheduler` 调度服务

**文件**: `backend/app/services/pipeline/trigger_scheduler.py`（新建）

核心逻辑分两部分：**主轮询** + **排队清理**。

```python
class TriggerScheduler:
    """
    轮询所有 PipelineTrigger，满足条件时触发对应 Pipeline 运行。
    支持防并发排队：运行时检测到 running 状态则写入排队表，下次轮询再执行。
    """

    async def poll_all_triggers(self) -> int:
        """扫描所有 enabled=True 的触发器，返回本次触发的 pipeline 数量"""

        # 1. 清理已完成执行对应的排队记录
        await self._cleanup_triggered_queue()

        # 2. 处理排队中的待触发项（若前次触发有运行完毕的，立即执行）
        await self._process_pending_queue()

        # 3. 查询所有 enabled=True 的 trigger
        triggers = await self._get_enabled_triggers()

        for trigger in triggers:
            if not self._should_trigger(trigger):
                continue

            # 4. 从源库查询当前 MAX(watermark_field)
            current_max = await self._get_current_max_value(trigger)
            if current_max is None:
                continue

            # 5. 比较水位：有新数据才触发
            if not self._has_new_data(trigger, current_max):
                continue

            # 6. 检查 pipeline 是否正在运行
            if await self._is_pipeline_running(trigger.pipeline_id):
                # 有运行中 → 写入排队表，等下次轮询再执行
                await self._enqueue_pending_trigger(trigger, current_max)
                logger.info(f"Pipeline {trigger.pipeline_id} 正在运行，已加入排队")
                continue

            # 7. 无运行中 → 直接触发
            old_watermark = trigger.last_watermark_value
            execution = await self._trigger_pipeline_run(trigger.pipeline_id)
            await self._update_trigger_watermark(trigger.id, current_max)
            await self._notify_triggered(trigger, old_watermark, current_max, execution.id)

    async def _process_pending_queue(self) -> None:
        """检查排队表，对已完成的待触发项执行 Pipeline"""
        pending_items = await self._get_pending_queue_items()
        for item in pending_items:
            if not await self._is_pipeline_running(item.pipeline_id):
                execution = await self._trigger_pipeline_run(item.pipeline_id)
                await self._mark_queue_item_triggered(item.id, execution.id)
                await self._notify_triggered_from_queue(item, execution.id)

    # _should_trigger：判断是否满足调度时间
    # - INTERVAL: (now - last_check_at) >= interval_seconds
    # - CRON: croniter 解析 cron_expr，判断当前时间是否匹配

    # _has_new_data：对比 last_watermark_value 与 current_max
    # _enqueue_pending_trigger：写入 pipeline_trigger_queue 表
```

---

### 排队表：`PipelineTriggerQueue`

**文件**: `backend/app/models/pipeline.py`

```python
class PipelineTriggerQueue(SQLModel, table=True):
    __tablename__ = "pipeline_trigger_queue"

    id: int = Field(default=None, primary_key=True)
    pipeline_id: int = Field(sa_column=Column(Integer, ForeignKey("data_pipelines.id"), index=True)
    trigger_id: int = Field(sa_column=Column(Integer, ForeignKey("pipeline_triggers.id"), index=True)
    watermark_value: str = Field(max_length=255)  # 待触发的水位值
    enqueued_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = Field(default="pending")         # pending / triggered / expired
    execution_id: Optional[int] = Field(default=None)
```

> 排队表的逻辑：主轮询发现有 running 状态时，将当前水位值写入队列。**下一次轮询**如果 running 已结束，立即触发（使用队列中记录的水位值，而非再次查询当前 MAX，这样可以精确捕获触发时刻的数据范围）。

---

### 步骤四：接入 APScheduler

**文件**: `backend/app/core/scheduler.py`（新建）

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")


async def poll_pipeline_triggers(app: FastAPI):
    """每分钟调度器：按 trigger 各自的 schedule 决定是否触发"""
    from app.db.session import async_session_maker
    from app.services.pipeline.trigger_scheduler import TriggerScheduler

    async with async_session_maker() as db:
        svc = TriggerScheduler(db, app.state.data_source_engines)
        triggered = await svc.poll_all_triggers()
        if triggered:
            logger.info(f"Pipeline 触发轮询完成，本次触发 {triggered} 条")


# 每 1 分钟执行一次，由 TriggerScheduler 内部判断各 trigger 的 interval / cron 条件
scheduler.add_job(
    poll_pipeline_triggers,
    IntervalTrigger(minutes=1),
    id="pipeline_trigger_poll",
    replace_existing=True,
)
```

**文件**: `backend/app/main.py`

在 FastAPI app 启动时注册：

```python
from app.core.scheduler import scheduler

@app.on_event("startup")
async def startup_event():
    scheduler.start()

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()
```

---

### 步骤五：前端新增"自动触发"配置

**文件**: `frontend/bi-dashboard/src/components/pipeline/visual-nodes/SourceNodeConfig.tsx`

在增量模式区域增加：

```tsx
<Form.Item label="数据变更自动触发">
  <Switch
    checked={config.autoTriggerEnabled}
    onChange={v => onChange({ ...config, autoTriggerEnabled: v })}
  />
</Form.Item>

{config.autoTriggerEnabled && (
  <>
    {/* 调度类型切换 */}
    <Form.Item label="调度方式">
      <Radio.Group
        value={config.triggerScheduleType ?? 'interval'}
        onChange={e => onChange({ ...config, triggerScheduleType: e.target.value })}
      >
        <Radio value="interval">简单间隔</Radio>
        <Radio value="cron">定时（每日几点）</Radio>
      </Radio.Group>
    </Form.Item>

    {/* 简单间隔 */}
    {config.triggerScheduleType !== 'cron' && (
      <Form.Item label="轮询间隔">
        <Select
          value={config.triggerIntervalSeconds ?? 1800}
          onChange={v => onChange({ ...config, triggerIntervalSeconds: v })}
          options={[
            { label: '每 5 分钟', value: 300 },
            { label: '每 15 分钟', value: 900 },
            { label: '每 30 分钟', value: 1800 },
            { label: '每 1 小时', value: 3600 },
            { label: '每 2 小时', value: 7200 },
            { label: '每 6 小时', value: 21600 },
            { label: '每 12 小时', value: 43200 },
          ]}
        />
      </Form.Item>
    )}

    {/* Cron 定时 */}
    {config.triggerScheduleType === 'cron' && (
      <Form.Item
        label="定时时间"
        tooltip="支持 Cron 表达式，如 0 8 * * * 表示每天 8:00"
      >
        <Input
          placeholder="0 8 * * *"
          value={config.triggerCronExpr ?? ''}
          onChange={e => onChange({ ...config, triggerCronExpr: e.target.value })}
        />
        <Text type="secondary" style={{ fontSize: 11 }}>
          例：0 8 * * * 每天 8:00；0 8,20 * * * 每天 8:00 和 20:00
        </Text>
      </Form.Item>
    )}

    {/* 监控字段 */}
    <Form.Item label="监控字段" tooltip="用于检测数据变化的字段，推荐使用 updated_at 或 id">
      <Select
        value={config.triggerWatermarkField ?? config.incrementalField}
        onChange={v => onChange({ ...config, triggerWatermarkField: v })}
        options={datetimeAndNumericColumns.map(col => ({
          label: `${col.name} (${col.type})`,
          value: col.name,
        }))}
      />
    </Form.Item>
  </>
)}
```

同时在 `config` 类型声明中增加字段。

---

### 步骤六：后端 API 接口

**文件**: `backend/app/api/v1/pipeline.py`

新增路由：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/pipeline/{pipeline_id}/trigger` | 创建/更新触发器配置 |
| GET | `/pipeline/{pipeline_id}/trigger` | 查询触发器配置 |
| DELETE | `/pipeline/{pipeline_id}/trigger` | 删除触发器 |
| POST | `/pipeline/{pipeline_id}/trigger/test` | 测试触发（立即执行一次） |

同时在 `PUT /pipeline/{pipeline_id}` 的保存逻辑中，解析 config 里的 `autoTriggerEnabled` 等字段，自动 upsert `PipelineTrigger` 记录。

---

## 四、关于「事务未提交」问题的说明

| 方案 | 触发时机 | 事务未提交风险 |
|------|---------|--------------|
| Binlog 实时 | binlog 写入时（事务中） | **有** - binlog 在事务 COMMIT 前就写入 |
| 触发器 | 事务内触发器执行 | **无** - 触发器中数据对外部不可见 |
| **轮询（本次方案）** | 定时查源表数据行 | **无** - 直接 SELECT MAX() 源表数据，已提交的才存在 |

轮询方案直接查**数据行本身**，不存在 binlog 的事务边界问题。

---

## 五、文件变更清单

| 步骤 | 操作 | 文件 |
|------|------|------|
| 1 | 新增 Model | `backend/app/models/pipeline.py` |
| 2 | 新增通知接口 | `backend/app/services/notifications/notification_hook.py` |
| 3 | 新增调度服务 | `backend/app/services/pipeline/trigger_scheduler.py` |
| 4 | 新增调度器初始化 | `backend/app/core/scheduler.py` |
| 5 | 修改主入口 | `backend/app/main.py` |
| 6 | 新增 API 接口 | `backend/app/api/v1/pipeline.py` |
| 7 | 扩展前端配置 | `frontend/bi-dashboard/src/components/pipeline/visual-nodes/SourceNodeConfig.tsx` |

---

## 六、依赖

新增 Python 依赖：

```
apscheduler>=3.10.0
croniter>=2.0.0   # 用于解析 Cron 表达式
```

前端无需新增依赖。
