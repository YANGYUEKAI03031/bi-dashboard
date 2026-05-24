-- ============================================
-- 迁移脚本：userID AUTO_INCREMENT
--
-- 用途：将 useraccount 表的 userID 列改为 AUTO_INCREMENT
--
-- 使用：
-- 1. 先备份数据库：mysqldump -u root -p users > backup/users_before_autoincrement.sql
-- 2. 执行本脚本：mysql -u root -p users < migrate_userid_autoincrement.sql
-- ============================================

-- 确认 userID 列的当前 AUTO_INCREMENT 状态
-- 如果已经是 AUTO_INCREMENT，本脚本会报错但不会破坏数据

-- MySQL 8.0+ 语法：修改列为 AUTO_INCREMENT
ALTER TABLE useraccount
MODIFY COLUMN userID INT NOT NULL AUTO_INCREMENT;

-- 验证修改结果
-- 应该显示 AUTO_INCREMENT 属性
SHOW COLUMNS FROM useraccount WHERE Field = 'userID';

-- 显示当前 AUTO_INCREMENT 的值（下次插入将使用这个值+1）
SHOW TABLE STATUS FROM users LIKE 'useraccount';
