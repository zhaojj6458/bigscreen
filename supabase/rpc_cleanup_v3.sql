-- 更新 RPC：清理重复数据 + 清理无效数据 (serial_number 为空)
-- 使用 SECURITY DEFINER 确保以超级用户权限执行，绕过 RLS 限制

create or replace function cleanup_duplicates()
returns json
language plpgsql
security definer -- 关键：以定义者权限运行，确保有权删除
set search_path = public -- 安全最佳实践
as $$
declare
  deleted_overview_count int;
  deleted_node_count int;
  deleted_null_sn_count int;
begin
  -- 0. 先清理 serial_number 为 NULL 或空字符串的无效数据
  -- 同时处理 'NULL', 'null' 这种可能的字符串脏数据
  with deleted_nulls as (
    delete from mese_person_node
    where serial_number is null 
       or serial_number = '' 
       or lower(serial_number) = 'null'
    returning 1
  )
  select count(*) into deleted_null_sn_count from deleted_nulls;

  -- 1. 清理 mese_overview (概况表)
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

  -- 2. 清理 mese_person_node (人员节点表)
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
