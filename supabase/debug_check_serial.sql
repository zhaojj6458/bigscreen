-- 调试脚本：检查特定流水号的数据是否存在
-- 将 'MAZ25-3401' 替换为您实际测试的流水号

-- 1. 检查是否存在该流水号的日志记录
select count(*) as log_count, 
       min(serial_number) as actual_serial, 
       length(min(serial_number)) as serial_len
from mese_person_node
where serial_number ilike '%MAZ25-3401%';

-- 2. 查看前 5 条相关日志，检查是否有特殊字符
select id, serial_number, node, person_name, start_time
from mese_person_node
where serial_number ilike '%MAZ25-3401%'
limit 5;

-- 3. 检查是否有权限 (如果上面能查到，说明 SQL Editor 有权限，但前端可能被 RLS 挡住)
-- 请务必执行 fix_rls_policy.sql 确保前端也能访问
