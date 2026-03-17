# SilicaClaw Release Notes

## v0.3.1-preview

SilicaClaw enters a stable LAN discovery preview stage.

### Highlights

- Stable real-network preview adapter for LAN
- Message dedupe, malformed tolerance, namespace isolation, size limits
- Peer lifecycle tracking (online/stale/cleanup)
- Peer observability panel in local-console
- Split network observability APIs:
  - `GET /api/network/config`
  - `GET /api/network/stats`

### Boundary Reminder

- No central business server
- No centralized database
- No login/chat/task/friend/payment/reputation modules
