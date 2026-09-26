SELECT e.kind, e.role, COUNT(*) n,
  SUM(e.driver_bot_sent_at IS NOT NULL) bot_sent,
  SUM(e.driver_bot_responded_at IS NOT NULL) bot_responded,
  SUM(e.driver_confirmed_at IS NOT NULL) confirmed,
  SUM(e.driver_task_sent_at IS NOT NULL) task_sent,
  SUM(e.driver_person_id IS NOT NULL) with_driver
FROM plan_order_executors e JOIN plan_orders o ON o.id=e.order_id
WHERE e.removed_at IS NULL AND o.deleted_at IS NULL AND o.created_at >= '2026-09-18'
GROUP BY e.kind, e.role;
SELECT driver_bot_status, COUNT(*) n FROM plan_order_executors WHERE created_at >= '2026-09-18' GROUP BY 1;
SELECT DATE(driver_bot_sent_at) d, COUNT(*) n FROM plan_order_executors WHERE driver_bot_sent_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 10;
