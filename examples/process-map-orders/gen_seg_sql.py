# Отрезки Планировки: отпечатки полей снимков истории + текущая строка + действия с автором (обезличено).
F = ['vehicle_gos', 'kind', 'start_hour', 'length_hours', 'manager_name', 'logist_name', 'driver_person_id', 'order_number',
     'stage', 'route_from', 'route_to', 'customer', 'trip_mode', 'needs_data', 'reason', 'repair_reason', 'repair_status', 'order_id']
snap = ",".join("LEFT(MD5(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(h.snapshot,'$.%s')),'null'),'')),8)" % f for f in F)
row = ",".join("LEFT(MD5(COALESCE(CAST(s.%s AS CHAR),'')),8)" % f for f in F)
sql = """WITH actors AS (SELECT email, CONCAT('A', DENSE_RANK() OVER (ORDER BY MD5(email))) aid FROM (SELECT DISTINCT overwritten_by email FROM plan_segs_history WHERE overwritten_by IS NOT NULL) x)
SELECT 'h' src, h.hist_id, h.seg_id, h.action, COALESCE(a.aid,''), COALESCE(u.role_key,''), DATE_FORMAT(h.recorded_at,'%%Y-%%m-%%d %%H:%%i:%%s'),
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(h.snapshot,'$.kind')),''), IF(JSON_EXTRACT(h.snapshot,'$.order_id') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(h.snapshot,'$.order_id')) IN ('','null'),0,1), %s
FROM plan_segs_history h LEFT JOIN actors a ON a.email=h.overwritten_by
LEFT JOIN user_access u ON u.email COLLATE utf8mb4_0900_ai_ci = h.overwritten_by
WHERE h.seg_id IN (SELECT seg_id FROM plan_segs_history WHERE action='create' AND recorded_at >= '2026-09-18')
UNION ALL
SELECT 'o', 999999999, s.id, 'current', '', '', DATE_FORMAT(s.updated_at,'%%Y-%%m-%%d %%H:%%i:%%s'), COALESCE(s.kind,''), s.order_id IS NOT NULL, %s FROM plan_segs s
WHERE s.id IN (SELECT seg_id FROM plan_segs_history WHERE action='create' AND recorded_at >= '2026-09-18')
ORDER BY 3, 2;
""" % (snap, row)
d = __file__.replace('gen_seg_sql.py', '')
open(d + 'seg.sql', 'w', encoding='utf-8').write(sql)
open(d + 'seg_fields.txt', 'w', encoding='utf-8').write("\n".join(F))
