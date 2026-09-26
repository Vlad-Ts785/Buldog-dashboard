WITH actors AS (
  SELECT email, CONCAT('A', DENSE_RANK() OVER (ORDER BY MD5(email))) aid FROM (SELECT DISTINCT changed_by email FROM plan_orders_history WHERE changed_by IS NOT NULL) x
)
SELECT h.id, h.order_id, h.action,
  CASE WHEN h.action IN ('update','status') THEN h.detail
       WHEN h.action='hired_set' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(h.detail,' · ',2),' · ',-1)
       WHEN h.action='driver_confirm' THEN IF(h.detail LIKE '%снято%','off','on')
       WHEN h.action='take' THEN IF(h.detail LIKE 'никто%','first','retake')
       ELSE '' END AS info,
  COALESCE(a.aid,'') actor, COALESCE(u.role_key, IF(h.changed_by IS NULL,'(system)','(no-access)')) role,
  DATE_FORMAT(h.changed_at,'%Y-%m-%d %H:%i:%s') at_msk,
  DATE_FORMAT(o.service_date,'%Y-%m-%d') service_date, COALESCE(o.status,'') cur_status, o.deleted_at IS NOT NULL deleted,
  COALESCE(o.created_role,'') created_role, o.internal, o.crm_deal_id IS NOT NULL has_deal
FROM plan_orders_history h
LEFT JOIN actors a ON a.email = h.changed_by
LEFT JOIN user_access u ON u.email COLLATE utf8mb4_0900_ai_ci = h.changed_by
LEFT JOIN plan_orders o ON o.id = h.order_id
ORDER BY h.order_id, h.changed_at, h.id;
