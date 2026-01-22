-- 概况表：每条记录代表一个三包条目
create table if not exists public.mese_overview (
  serial_number text primary key,
  department text not null,
  customer_name text not null,
  installation_stage text not null,
  material_name text not null,
  drawing_number text null,
  warranty_count int4 not null,
  warranty_type text not null, -- 基板损坏/非基板损坏/缺件/错件等
  fault_description text not null,
  source_month date null, -- 可选：上传月份快照
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 人员节点日志：一个流水号可对应多条节点记录
create table if not exists public.mese_person_node (
  id bigserial primary key,
  serial_number text not null references public.mese_overview(serial_number) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  node text not null,
  person_name text not null,
  created_at timestamptz default now()
);

-- 去重与更新策略：
-- 概况表以 serial_number 作为自然主键，重复上传采用 upsert 直接覆盖更新
-- 人员节点日志以以下组合唯一约束防止重复插入（同一事件的完全相同记录不重复）
create unique index if not exists uq_person_node_tuple
on public.mese_person_node (serial_number, start_time, end_time, node, person_name);

-- 自动更新时间戳
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_overview_updated_at on public.mese_overview;
create trigger trg_overview_updated_at
before update on public.mese_overview
for each row execute function public.set_updated_at();

