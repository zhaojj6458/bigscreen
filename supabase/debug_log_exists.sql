-- 深度排查脚本：检查日志表数据是否存在，以及格式问题
-- 针对用户反馈的 MAZ25-3401 等流水号

select 
  count(*) as total_records,
  count(case when serial_number ilike '%MAZ25-3401%' then 1 end) as maz3401_count,
  count(case when serial_number ilike '%MAZ25-3381%' then 1 end) as maz3381_count,
  count(case when serial_number ilike '%MAZ25-3546%' then 1 end) as maz3546_count
from mese_person_node;

-- 抽样查看几条数据，看看流水号长什么样 (是否有隐藏字符)
select id, serial_number, length(serial_number) as len, encode(serial_number::bytea, 'hex') as hex_val
from mese_person_node
limit 5;
