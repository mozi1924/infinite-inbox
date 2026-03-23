CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  from_address TEXT,
  to_address TEXT,
  to_domain TEXT,
  subject TEXT,
  text_preview TEXT,
  text_content TEXT,
  html_content TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_emails_to_domain ON emails(to_domain);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);
