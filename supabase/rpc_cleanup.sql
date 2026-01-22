-- 创建一个 RPC (Remote Procedure Call) 函数，供前端直接调用
-- 功能：删除重复数据，只保留最新的 (id 最大的)

create or replace function cleanup_duplicates()
returns json
language plpgsql
as $$
declare
  deleted_overview_count int;
  deleted_node_count int;
begin
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
  -- 注意：这里需要处理 NULL 值，使用 COALESCE 确保 NULL 被视为相同
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
    'deleted_overview', deleted_overview_count,
    'deleted_nodes', deleted_node_count
  );
end;
$$;
