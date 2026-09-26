# Генерирует SQL: для каждого снимка заявки (история) и для текущей строки - MD5 нормализованного
# значения каждого редактируемого поля. Сами значения наружу не уходят, только отпечатки.
F = ['equipment_type', 'note', 'service_time', 'customer', 'cargo_dims', 'gabarit', 'rework_terms', 'documents',
     'payment_status', 'cargo', 'load_address', 'unload_address', 'cargo_weight_t', 'price', 'needs_data', 'cash',
     'executor_entity_id', 'customer_contact_name', 'customer_contact_phone', 'load_contact_name', 'load_contact_phone',
     'unload_contact_name', 'unload_contact_phone', 'load_lat', 'load_lon', 'unload_lat', 'unload_lon',
     'customer_entity_id', 'internal', 'payment_mode', 'payment_days', 'correspondence_email', 'correspondence_phone',
     'delivery_time', 'status', 'taken_by', 'manager_email']
snap = ",".join("LEFT(MD5(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(h.snapshot,'$.%s')),'null'),'')),8)" % f for f in F)
row = ",".join("LEFT(MD5(COALESCE(CAST(o.%s AS CHAR),'')),8)" % f for f in F)
sql = """SELECT 'h' src, h.id, h.order_id, h.action, %s FROM plan_orders_history h
WHERE h.snapshot IS NOT NULL AND h.order_id IN (SELECT DISTINCT order_id FROM plan_orders_history WHERE action='create' AND changed_at >= '2026-09-18')
UNION ALL
SELECT 'o', 999999999, o.id, 'current', %s FROM plan_orders o
WHERE o.id IN (SELECT DISTINCT order_id FROM plan_orders_history WHERE action='create' AND changed_at >= '2026-09-18')
ORDER BY 3, 2;
""" % (snap, row)
open(__file__.replace('gen_snap_sql.py', 'snap.sql'), 'w', encoding='utf-8').write(sql)
open(__file__.replace('gen_snap_sql.py', 'snap_fields.txt'), 'w', encoding='utf-8').write("\n".join(F))
