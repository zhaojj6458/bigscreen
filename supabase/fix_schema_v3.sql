-- 1. 重建唯一索引 (缩小范围以支持更新)
-- 我们认为：同一个流水号 + 同一个物料名称 + 同一个图号 = 同一条记录
-- 如果再次上传相同的组合，视为更新 (例如修正了故障描述或三包类型)

drop index if exists idx_mese_overview_unique;

-- 注意：Postgres 默认认为 NULL != NULL，所以为了唯一索引生效，建议应用层将空值转为空字符串
-- 或者使用 coalesce 在索引定义中 (但在 Supabase/Postgres 中，upsert 的 on conflict 推断需要列名匹配)
-- 最好的做法是：数据库列允许 NULL，但我们约定存入空字符串；或者直接建立索引。
-- 这里我们假设应用层已将 NULL 转为 ''。

create unique index idx_mese_overview_unique 
on mese_overview (serial_number, material_name, drawing_number);

-- 2. 确保列定义兼容
-- 既然我们用这三列做 Key，建议它们不为 NULL (虽然 Postgres 允许索引列 NULL，但 upsert 处理起来麻烦)
-- 下面语句将 NULL 更新为 '' (仅当列是 text 类型时)
update mese_overview set material_name = '' where material_name is null;
update mese_overview set drawing_number = '' where drawing_number is null;

-- (可选) 设置列为 NOT NULL default ''，防止未来插入 NULL
alter table mese_overview alter column material_name set default '';
alter table mese_overview alter column drawing_number set default '';
