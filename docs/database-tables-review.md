# 数据库表与 BI 项目对应关系

根据 `backend/app/models` 和 `backend/app` 下的代码分析结果。

---

## 一、项目正在使用的表（请勿删除）

这些表在代码中有对应的 SQLAlchemy 模型或外键引用：

| 表名 | 说明 | 模型位置 |
|------|------|----------|
| `useraccount` | 用户账号 | `app/models/user.py` |
| `dashboards` | 仪表板 | `app/models/dashboard.py` |
| `dashboard_cards` | 仪表板卡片 | `app/models/dashboard.py` |
| `dashboard_tabs` | 仪表板标签页 | `app/models/dashboard.py` |
| `visualization_cards` | 可视化/图表 | `app/models/visualization.py` |
| `databases` | 数据源连接配置 | `app/models/visualization.py` |
| `report_pages` | 报表页 | `app/models/report_page.py` |
| `report_page_dashboards` | 报表页与仪表盘关联 | `app/models/report_page.py` |
| `processed_datasets` | 处理后的数据集 | `app/models/data_source.py` |

---

## 二、疑似与当前 BI 项目无关的表（建议你确认后手动删除）

以下表在 **当前项目** 的 `backend/app` 中**没有任何模型定义和引用**，很可能是历史库、Metabase 迁移残留或其它系统留下的表。

| 表名 | 说明/可能来源 |
|------|----------------|
| `batch_tasks` | 批任务表，当前项目未使用 |
| `cache_configs` | 缓存配置表，当前项目未使用 |
| `processed_datasets_metadata` | 与 `processed_datasets` 名字相关，但项目里没有对应模型或引用，可能是旧版或其它系统的元数据表 |
| `report_card` | 命名类似 Metabase 的 report_card，当前项目用的是 `report_pages` / `report_page_dashboards`，未使用本表 |
| `report_dashboardcard` | 同上，Metabase 风格关联表，当前项目未使用 |
| `workflow_executions` | 工作流执行记录，当前项目未使用 |

---

## 三、请你确认的步骤

1. **再次确认**：用数据库客户端或 SQL 查一下以上 6 张表是否有数据、是否被其它系统（如定时任务、脚本、其他服务）使用。
2. **备份**：删除前建议对数据库或至少对这 6 张表做备份（导出结构+数据或快照）。
3. **删除顺序**：若存在外键，先删子表再删主表；若没有外键，可任意顺序删除。  
   建议删除顺序（若存在依赖）：  
   `report_dashboardcard` → `report_card` → 其余 4 张表按需删除。
4. **删除后**：重启 BI 应用，做一次核心功能回归（登录、看板、报表、数据源），确认无报错。

---

## 四、如需保留的表

- 若 `processed_datasets_metadata` 是你其它脚本或系统在写的“处理结果元数据”，请保留并忽略本文“建议删除”的推荐。
- 若 `batch_tasks` / `workflow_executions` 是计划中要用的功能，可暂时保留，等新功能开发时再接入。

确认无误后，你可以在数据库里手动执行 `DROP TABLE ...` 删除上述不需要的表。
