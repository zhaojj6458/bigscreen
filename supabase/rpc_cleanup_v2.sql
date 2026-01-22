-- 更新 RPC：清理重复数据 + 清理无效数据 (serial_number 为空)

create or replace function cleanup_duplicates()
returns json
language plpgsql
as $$
declare
  deleted_overview_count int;
  deleted_node_count int;
  deleted_null_sn_count int;
begin
  -- 0. 先清理 serial_number 为 NULL 的无效数据 (针对人员节点表)
  -- 概况表的主键就是 serial_number 相关的，如果为空通常没意义，也一并清理
  with deleted_nulls as (
    delete from mese_person_node
    where serial_number is null or serial_number = ''
    returning 1
  )
  select count(*) into deleted_null_sn_count from deleted_nulls;

  -- 1. 清理 mese_overview (概况表)
  -- 逻辑：如果 (serial_number, material_name, drawing_number) 相同，保留 id 最大的
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
  -- 逻辑：如果 (serial_number, start_time, end_time, node, person_name) 相同，保留 id 最大的
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
