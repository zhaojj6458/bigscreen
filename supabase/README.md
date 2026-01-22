# Supabase 月度上传与去重指南

## 准备工作
- 在 Supabase 上执行 schema：`supabase/schema.sql`，创建两张表与唯一约束
- 获取项目的 `SUPABASE_URL` 与 `SERVICE_ROLE` Key（仅服务端使用）
- 安装依赖：
  - Node.js 环境
  - `npm i @supabase/supabase-js csv-parse`

## 文件说明
- 概况：`MESE三包概况.csv`（逗号分隔，含多行故障描述，需引号）
- 人员节点：`MESE三包日志人员节点1229.utf8.csv`（制表符分隔，UTF-8）
  - 若原文件为 UTF-16LE，请先转为 UTF-8

## 上传命令
```bash
export SUPABASE_URL="https://<your-project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
node scripts/upload_csv.js "c:/Users/HP/Desktop/TR数据大屏3/MESE三包概况.csv" "c:/Users/HP/Desktop/TR数据大屏3/MESE三包日志人员节点1229.utf8.csv"
```

## 去重与更新策略
- 概况表（mese_overview）
  - 主键：`serial_number`
  - 行为：同一 `serial_number` 再次上传时，使用 upsert 更新最新内容（避免重复）
- 人员节点表（mese_person_node）
  - 唯一约束：`serial_number,start_time,end_time,node,person_name`
  - 行为：同一事件的完全相同记录不会重复插入；如果时间或节点变化，会新增记录

## 每月操作流程
1. 将人员节点文件转为 UTF-8（如需）：保存在 `MESE三包日志人员节点1229.utf8.csv`
2. 执行上传脚本（见“上传命令”）
3. 验证：
   - 概况表：查询相同 `serial_number` 是否已更新（updated_at 时间戳变化）
   - 人员节点表：重复记录不增加计数；变更记录新增

## 常见问题
- 故障描述包含换行与逗号：确保 CSV 以引号包裹该列（文件示例已如此）
- 日期解析失败：脚本中使用 ISO 转换，若有特殊格式，请反馈以增强解析器
