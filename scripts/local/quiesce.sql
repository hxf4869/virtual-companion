-- Local copy of production data must not send notifications or run
-- scheduled model calls. Manual chat is unchanged.
UPDATE vc.proactive_policy SET enabled = false WHERE enabled;
UPDATE vc.notification_channel SET enabled = false WHERE enabled;
UPDATE vc.notification_delivery
   SET status = 'stopped',
       stopped_reason = 'cancelled',
       failure_code = NULL,
       correlation_id = NULL
 WHERE status = 'pending';
UPDATE vc.follow_up
   SET status = 'CANCELLED',
       trigger_at = NULL,
       cancelled_at = clock_timestamp()
 WHERE status = 'SCHEDULED';
UPDATE vc.work_item
   SET status = 'CANCELLED',
       finished_at = clock_timestamp(),
       claim_token = NULL,
       lease_expires_at = NULL
 WHERE kind IN ('FOLLOW_UP', 'MEMORY_EXTRACT', 'ST_MEMORY_EXTRACT', 'GENERATION')
   AND status IN ('PENDING', 'CLAIMED');
