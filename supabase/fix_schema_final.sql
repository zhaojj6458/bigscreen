-- 终极修复脚本：重置表结构与约束
-- 警告：这将清空所有数据！请确保您有原始 CSV 文件可供重新上传。

-- 1. 清空数据 (必须先清空，否则如果有重复数据，无法建立唯一约束)
truncate table mese_overview;
truncate table mese_person_node;

-- 2. 修复 mese_overview 表结构
-- 删除旧的索引和约束，防止冲突
drop index if exists idx_mese_overview_unique;
alter table mese_overview drop constraint if exists mese_overview_serial_number_key;
alter table mese_overview drop constraint if exists unique_overview_constraint;

-- 建立严格的唯一约束 (serial_number + material_name + drawing_number)
-- 这将确保 ON CONFLICT 语句能正常工作
alter table mese_overview 
add constraint unique_overview_constraint 
unique (serial_number, material_name, drawing_number);

-- 3. 修复 mese_person_node 表结构
drop index if exists idx_mese_person_node_unique;
alter table mese_person_node drop constraint if exists unique_person_node_constraint;

-- 建立严格的唯一约束
alter table mese_person_node 
add constraint unique_person_node_constraint 
unique (serial_number, start_time, end_time, node, person_name);

-- 4. 确保年份字段存在
alter table mese_overview add column if not exists report_year int;
create index if not exists idx_mese_overview_year on mese_overview(report_year);
