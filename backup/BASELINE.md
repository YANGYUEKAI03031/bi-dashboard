# 优化基线记录

| 项 | 值 |
|----|-----|
| 日期 | 2026-05-24 |
| Git commit | `135dc812ed9f3b5b59ec5dcb0f55a671c7120b4d` |
| 分支 | `new_version` |
| 测试账号 | 杨悦凯（admin, user_id=1） |
| DB 备份 | `backup/users_20260524.sql`（mysqldump 未在 PATH，请在本机 MySQL 工具目录手动备份） |

## 阶段 0 基线（改前）

- [x] 后端 `launch_server.py` 运行正常 (:8000)
- [x] 登录 API 验证通过
- [x] 账号角色 admin 确认

## 批次 1.1 变更（2026-05-24 已完成）

- [x] `.gitignore`、`.env.example`
- [x] `git rm --cached backend/.env`
- [x] `config.py` 去除硬编码密钥、修复 Redis URL
- [x] `auth.py` 去除密码日志
- [x] 前端移除 mysql2、清理 auth 相关 console.log
- [x] `npm run build` 通过
- [x] 登录 API 改后验证通过

## 批次 1.2 密码 bcrypt（2026-05-24 已完成）

- [x] `useraccount` 表新增 `password_hash` 列
- [x] 3 个用户密码已迁移为 bcrypt（`$2b$12$...`）
- [x] 登录/改密/创建用户 改用 `check_password` / `assign_password`
- [x] 修复 passlib 与 bcrypt 5.x 不兼容，改用 `bcrypt` 库直接哈希
- [x] 双轨兼容：hash 优先，明文 `password` 列暂保留
- [x] 登录 API 验证通过（杨悦凯 / 123456）

**注意**：请重启后端 `launch_server.py` 使改动生效（若仍在跑旧进程）。

## 批次 1.3 密码迁移完成（2026-05-24 已完成）

- [x] 所有用户 `password_hash` 已设置（3/3 用户）
- [x] bcrypt 验证正常（杨悦凯 / 123456）
- [x] 删除明文 `password` 列
- [x] `security.py` 移除明文兼容逻辑
- [x] `user.py` 模型移除 `password` 字段
- [x] 登录 API 验证通过

## 批次 2 SQL 注入修复（2026-05-24 已完成）

- [x] `chart_service.py` - 仪表盘筛选参数值转义
- [x] `chart_service.py` - 重试逻辑中的参数值转义
- [x] `temp_table_manager.py` - `step_id` 白名单校验
- [x] `temp_table_manager.py` - `insert_step_data` 参数化查询
- [x] `temp_table_manager.py` - 列名白名单校验
- [x] `trigger_scheduler.py` - 表名/字段名白名单校验

## 阶段 2.1 数据源密码加密（2026-05-24 已完成）

- [x] 新增 `app/core/crypto.py` - Fernet 加解密模块
- [x] `config.py` 新增 `ENCRYPTION_KEY` 配置项
- [x] `datasources.py` - 创建数据源时加密密码存储
- [x] `datasources.py` - 获取连接时解密密码
- [x] `chart_service.py` - 图表查询时解密密码（2 处）
- [x] 新增 `encrypt_existing_passwords.py` - 迁移脚本
- [x] 新增 `tests/test_crypto.py` - 加密模块测试（7 个用例）
- [x] 所有 56 个单元测试通过

**使用前准备**：
1. 在 `backend/.env` 中添加 `ENCRYPTION_KEY`：
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
2. 运行迁移脚本加密已有数据源密码：
   ```bash
   python encrypt_existing_passwords.py
   ```

## 阶段 2.2 userID AUTO_INCREMENT（2026-05-24 已完成）

- [x] `models/user.py` - `userID` 列添加 `autoincrement=True`
- [x] `permission_service.py` - 移除手动 `MAX(userID)+1` 计算
- [x] `migrations/migrate_userid_autoincrement.sql` - 迁移 SQL

**数据库迁移**（需要手动执行一次）：
```sql
ALTER TABLE useraccount MODIFY COLUMN userID INT NOT NULL AUTO_INCREMENT;
```
