-- 1. 创建 Storage Bucket (如果不存在)
-- 注意：Supabase Storage Buckets 通常通过 Dashboard 或 API 创建。
-- 以下 SQL 尝试插入 storage.buckets 表，但如果没有权限可能会失败。
-- 最稳妥的方式是在 Supabase Dashboard -> Storage -> Create new bucket -> 命名为 'mese-data'，并设为 Public (或配置 Policy)。

insert into storage.buckets (id, name, public)
values ('mese-data', 'mese-data', true)
on conflict (id) do nothing;

-- 2. Storage 访问策略 (RLS)
-- 允许所有用户 (包括 anon) 对 mese-data 桶进行读写
create policy "Public Access to mese-data"
on storage.objects for all
using ( bucket_id = 'mese-data' )
with check ( bucket_id = 'mese-data' );

-- 3. 数据库表访问策略 (RLS)
-- 确保前端 (anon key) 可以读写这两张表

-- 启用 RLS (如果尚未启用)
alter table mese_overview enable row level security;
alter table mese_person_node enable row level security;

-- 允许所有操作 (select, insert, update, delete) 给所有用户
-- 警告：这是宽依策略，适用于内部工具。生产环境请限制。
create policy "Allow all access to mese_overview"
on mese_overview for all
using (true)
with check (true);

create policy "Allow all access to mese_person_node"
on mese_person_node for all
using (true)
with check (true);
