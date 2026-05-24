# BI-Dashboard 后端 Top 5 优先级问题及处理方案

> 生成时间：2026-05-12 | 项目路径：/mnt/e/bi-dashboard

---

## P1: 密码明文存储

**现状**：`auth.py` 直接 `user.password == form.password`，security.py 里的 bcrypt 函数从未调用

**处理步骤**：
1. 安装依赖：`pip install passlib[bcrypt]`（requirements.txt 里可能缺这个）
2. `models/user.py` 新增字段 `password_hash`，保留原 `password` 字段做迁移
3. 写一次性迁移脚本：遍历所有用户，将 `password` 明文 → bcrypt hash 存入 `password_hash`
4. `auth.py` 登录改用：`verify_password(form.password, user.password_hash)`
5. 注册/创建用户改用：`user.password_hash = get_password_hash(password)`
6. 验证无误后删掉 `password` 明文字段

---

## P2: SQL注入风险

**现状**：`chart_service.py` 过滤参数值直接 `f"...'{param_value}'"` 拼接

**处理步骤**：
1. 在 `chart_service.py` 的 `_metric_filter_sql_clauses()` 中，所有参数值改为 `%s` 占位符
2. 返回值从纯 SQL 字符串改为 `(sql_fragment, params_list)` 元组
3. 执行时用 `await session.execute(text(sql), params)` 参数化绑定
4. `temp_table_manager.py` 的表名/列名用白名单校验（只允许 `[a-zA-Z0-9_]`），值用参数绑定
5. `trigger_scheduler.py` 同理，字段名反引号包裹+白名单，值参数化

---

## P3: JWT Secret 硬编码入库

**现状**：`.env` 文件包含 `SECRET_KEY=xxx` 并提交到 Git

**处理步骤**：
1. `.env` 改为 `.env.example`，只放占位符 `SECRET_KEY=your-secret-key-here`
2. `.gitignore` 加入 `.env`
3. `git rm --cached backend/.env` 从仓库移除
4. 生产环境通过系统环境变量注入：`export SECRET_KEY=$(openssl rand -hex 32)`
5. `core/config.py` 的 Settings 已经支持环境变量覆盖，无需改代码

---

## P4: engine.py God Class 拆分

**现状**：4069行/190KB，SQL生成+验证+类型推断+批处理+增量更新全在一起

**处理步骤**：
1. 拆分为4个类，保留 `PipelineEngine` 作为编排器：
   - `SQLBuilder` — `_build_step_sql()`、列投影、行过滤、列重命名
   - `StepExecutor` — `_execute_step_via_insert_select()`、批处理、临时表写入
   - `TypeInferrer` — `_preview_infer_output_columns()`、`_fetch_mysql_table_columns()`、`_canonical_pipeline_node_type()`
   - `PipelineValidator` — `_validate_sql()`、拓扑排序、节点校验
2. `PipelineEngine.run()` 只负责编排流程：排序 → 依次构建SQL → 执行 → 预览
3. 逐步迁移，每拆出一个类跑一遍 Pipeline 全流程测试

---

## P5: User.userID 无自增 + 异常处理统一

**现状**：`SELECT MAX(userID)+1` 手动生成ID导致竞态；所有异常 `raise Exception(str(e))` 丢类型

**处理步骤**：
1. `models/user.py`：`userID = Column(Integer, primary_key=True, autoincrement=True)`
2. `permission_service.py` 的 `create_user()` 去掉手动ID生成逻辑
3. 新建 `app/exceptions.py`：
   ```python
   class AppException(Exception): ...
   class NotFoundError(AppException): ...
   class PermissionDeniedError(AppException): ...
   class ValidationError(AppException): ...
   class DatabaseError(AppException): ...
   ```
4. Services 中 `raise Exception(str(e))` → `raise DatabaseError(str(e))`
5. FastAPI 添加全局异常处理器，统一错误响应格式
