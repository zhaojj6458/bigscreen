-- 1. 添加年份字段
alter table mese_overview add column if not exists report_year int;

-- 2. 创建索引 (加速年份查询)
create index if not exists idx_mese_overview_year on mese_overview(report_year);

-- 3. 回填历史数据
-- 逻辑：提取 serial_number 中的第一个连续两位数字，并加上 2000
-- 例如：MAZ25-xxx -> 25 -> 2025
--      23MAX08 -> 23 -> 2023
--      SBN43... -> 43 -> 2043 (可能有误判，但针对 MBY/MAZ/23MAX 是准确的)
-- 如果找不到数字，默认设为当前年份或 2025

update mese_overview
set report_year = (
  case 
    when substring(serial_number from '(\d{2})') is not null 
    then 2000 + cast(substring(serial_number from '(\d{2})') as int)
    else 2025 -- 默认值
  end
)
where report_year is null;
