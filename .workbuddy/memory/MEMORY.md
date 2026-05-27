# BI Dashboard 项目长期记忆

## 项目评分
- **当前**: ~66-68/100（P0优化后，原57）
- **上次评估**: 安全性62→70, 可维护性58→61, 代码规范63→71, 总分57→~66
- **P1目标**: 70-75（补测试、strictNullChecks、解耦循环依赖）

## 技术栈
- **后端**: FastAPI + SQLAlchemy + MySQL (aiomysql) + Redis
- **前端**: React 19 + TypeScript 4.9.5 + Ant Design 6 + ECharts 6 + react-grid-layout v2.2.2
- **构建**: react-scripts (CRA) 5.0.1

## 关键发现
- react-grid-layout v2 使用 `dragConfig={{ enabled: false }}` 替代 v1 的 `isDraggable={false}`
- 前端 TypeScript: `strict: true`, `noImplicitAny: true`, `strictNullChecks: false`（留到P1）

## 代码质量工具
- **前端**: ESLint (.eslintrc.json) + Prettier (.prettierrc)，已配置 lint/format 脚本
- **后端**: ruff (pyproject.toml)，已替代 flake8+black 作为主要 lint/format 工具
- `.env` 不在 git 追踪中，`.env.example` 是模板

## SQL 安全加固
- chart_service.py: `_validate_field_name()` 白名单 + `_ALLOWED_OPS` 白名单 + 未知 op 返回 None
- pipeline_service.py: DROP TABLE 使用 `validate_and_quote_table_name()` 校验表名
- frontend: 所有 console.log 已清零，仅保留必要的 console.error/warn

## 用户偏好
- 项目路径: E:\bi-dashboard
- 前端路径: E:\bi-dashboard\frontend\bi-dashboard
- 后端路径: E:\bi-dashboard\backend
