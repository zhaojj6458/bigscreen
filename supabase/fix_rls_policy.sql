-- 开启 RLS (如果未开启)
alter table mese_person_node enable row level security;

-- 允许所有读写 (开发环境宽松策略)
-- 注意：如果是生产环境，建议只允许 authenticated 用户读取
create policy "Allow public access to mese_person_node"
on mese_person_node for all
using (true)
with check (true);

-- 同时也检查 mese_overview 的策略
create policy "Allow public access to mese_overview"
on mese_overview for all
using (true)
with check (true);
