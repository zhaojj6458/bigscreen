-- 1. 增强版去重与清理 (v4)
create or replace function cleanup_duplicates()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_overview_count int;
  deleted_node_count int;
  deleted_null_sn_count int;
begin
  -- 0. 清理无效数据
  -- 增加对空白字符的检查 (regex: ^\s*$)
  with deleted_nulls as (
    delete from mese_person_node
    where serial_number is null 
       or serial_number = '' 
       or lower(serial_number) = 'null'
       or serial_number ~ '^\s*$' -- 匹配纯空白字符
    returning 1
  )
  select count(*) into deleted_null_sn_count from deleted_nulls;

  -- 1. 清理 mese_overview (保留最新)
  with duplicates as (
    select id,
           row_number() over (
             partition by serial_number, material_name, drawing_number 
             order by id desc
           ) as rn
    from mese_overview
  ),
  deleted as (
    delete from mese_overview
    where id in (select id from duplicates where rn > 1)
    returning 1
  )
  select count(*) into deleted_overview_count from deleted;

  -- 2. 清理 mese_person_node (保留最新)
  with duplicates as (
    select id,
           row_number() over (
             partition by 
               serial_number, 
               coalesce(start_time, '1970-01-01'::timestamptz), 
               coalesce(end_time, '1970-01-01'::timestamptz), 
               coalesce(node, ''), 
               coalesce(person_name, '')
             order by id desc
           ) as rn
    from mese_person_node
  ),
  deleted as (
    delete from mese_person_node
    where id in (select id from duplicates where rn > 1)
    returning 1
  )
  select count(*) into deleted_node_count from deleted;

  return json_build_object(
    'deleted_null_sn', deleted_null_sn_count,
    'deleted_overview', deleted_overview_count,
    'deleted_nodes', deleted_node_count
  );
end;
$$;

-- 2. 新增：清空表 (用于全量覆盖上传前)
create or replace function truncate_table(table_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 仅允许清空指定表，防止滥用
  if table_name not in ('mese_overview', 'mese_person_node') then
    raise exception 'Invalid table name';
  end if;

  execute format('truncate table %I', table_name);
end;
$$;
