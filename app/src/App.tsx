import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Container,
  Typography,
  Box,
  Toolbar,
  AppBar,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  TextField,
  Pagination,
  CircularProgress,
  IconButton,
  Tooltip,
  Alert,
  Paper,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import LogoutIcon from '@mui/icons-material/Logout';
import EmailList from './components/EmailList';
import EmailViewerModal from './components/EmailViewerModal';

const isDev = import.meta.env.DEV || window.location.port === '5173';
const API_BASE = isDev ? 'http://localhost:8787' : '';
const WS_BASE = isDev
  ? 'ws://localhost:8787/api/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

type EmailSummary = {
  id: string;
  message_id?: string;
  from_address: string;
  to_address: string;
  to_domain: string;
  subject: string;
  text_preview: string;
  created_at: number;
  text_content?: string;
  html_content?: string;
};

type EmailResponse = {
  emails?: EmailSummary[];
  total?: number;
};

type SessionResponse = {
  authenticated?: boolean;
};

const isNotificationSupported = typeof window !== 'undefined' && 'Notification' in window;

function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

function canShowBrowserNotification() {
  return isNotificationSupported && Notification.permission === 'granted' && document.visibilityState !== 'visible';
}

export default function App() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginKey, setLoginKey] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    isNotificationSupported ? Notification.permission : 'denied'
  );
  const [domainFilter, setDomainFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewingEmail, setViewingEmail] = useState<EmailSummary | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const closeSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (pingIntervalRef.current) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    setAuthenticated(false);
    setEmails([]);
    setTotal(0);
    setSelectedIds([]);
    setViewingEmail(null);
    setLoadingEmail(false);
    setAuthError('登录状态已失效，请重新输入 API 密钥。');
    closeSocket();
  }, [closeSocket]);

  const apiFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const response = await fetch(input, {
        ...init,
        credentials: 'include',
        headers: {
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 401) {
        handleUnauthorized();
      }

      return response;
    },
    [handleUnauthorized]
  );

  const checkSession = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/session`);
      if (!res.ok) {
        setAuthenticated(false);
        return;
      }
      const data = (await res.json()) as SessionResponse;
      setAuthenticated(Boolean(data.authenticated));
    } catch (err) {
      console.error('Failed to check session', err);
      setAuthenticated(false);
    } finally {
      setInitializing(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const handleSelectEmail = useCallback(
    async (email: EmailSummary) => {
      setViewingEmail(email);
      setLoadingEmail(true);

      const url = new URL(window.location.href);
      url.searchParams.set('email', email.id);
      window.history.pushState({}, '', url);

      try {
        const res = await apiFetch(`${API_BASE}/api/emails/${email.id}`);
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const full = (await res.json()) as EmailSummary;
        setViewingEmail(full);
      } catch (err) {
        console.error('Failed to load full email', err);
      } finally {
        setLoadingEmail(false);
      }
    },
    [apiFetch]
  );

  const closeEmailViewer = () => {
    setViewingEmail(null);
    setLoadingEmail(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('email');
    window.history.pushState({}, '', url);
  };

  const requestNotificationPermission = async () => {
    if (!isNotificationSupported) {
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const emailId = params.get('email');
    if (emailId) {
      void handleSelectEmail({
        id: emailId,
        subject: 'Loading...',
        from_address: '...',
        to_address: '',
        to_domain: '',
        text_preview: '',
        created_at: Date.now(),
      });
    }

    const onPopState = () => {
      const nextParams = new URLSearchParams(window.location.search);
      const nextEmailId = nextParams.get('email');
      if (nextEmailId) {
        void handleSelectEmail({
          id: nextEmailId,
          subject: 'Loading...',
          from_address: '',
          to_address: '',
          to_domain: '',
          text_preview: '',
          created_at: Date.now(),
        });
      } else {
        setViewingEmail(null);
        setLoadingEmail(false);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [authenticated, handleSelectEmail]);

  useEffect(() => {
    if (!isNotificationSupported) {
      return;
    }

    const syncPermission = () => setNotificationPermission(Notification.permission);
    document.addEventListener('visibilitychange', syncPermission);
    window.addEventListener('focus', syncPermission);

    return () => {
      document.removeEventListener('visibilitychange', syncPermission);
      window.removeEventListener('focus', syncPermission);
    };
  }, []);

  const fetchEmails = useCallback(async () => {
    if (!authenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      let url = `${API_BASE}/api/emails?limit=${limit}&offset=${offset}`;
      if (domainFilter) {
        url += `&domain=${encodeURIComponent(domainFilter)}`;
      }

      const res = await apiFetch(url);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as EmailResponse;
      setEmails(data.emails || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authenticated, domainFilter, limit, page]);

  useEffect(() => {
    if (!authenticated) {
      setEmails([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    void fetchEmails();
  }, [authenticated, fetchEmails]);

  useEffect(() => {
    if (!authenticated) {
      closeSocket();
      return;
    }

    let active = true;

    const connectWs = () => {
      if (!active) {
        return;
      }

      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') {
          return;
        }

        try {
          const data = JSON.parse(event.data) as { type?: string; email?: EmailSummary; ids?: string[] };

          if (data.type === 'NEW_EMAIL' && data.email) {
            const email = data.email;
            const normalizedFilter = normalizeDomain(domainFilter);
            const emailDomain = normalizeDomain(email.to_domain || '');
            const matchesFilter = !normalizedFilter || normalizedFilter === emailDomain;

            if (canShowBrowserNotification()) {
              const notification = new Notification(`New Email: ${email.subject || 'No Subject'}`, {
                body: `From: ${email.from_address || 'Unknown sender'}\n${email.text_preview || 'Open Infinite Inbox to view the full message.'}`,
                tag: email.id,
              });
              notification.onclick = () => {
                window.focus();
                void handleSelectEmail(email);
                notification.close();
              };
            }

            if (!matchesFilter) {
              return;
            }

            setEmails((prev) => {
              const deduped = prev.filter((item) => item.id !== email.id);
              const nextEmails = [email, ...deduped];

              if (page !== 1) {
                return prev;
              }

              return nextEmails.slice(0, limit);
            });

            setTotal((currentTotal) => currentTotal + 1);
          } else if (data.type === 'DELETE_EMAILS') {
            const ids = Array.isArray(data.ids) ? data.ids : [];
            if (ids.length === 0) {
              return;
            }

            setEmails((prev) => prev.filter((email) => !ids.includes(email.id)));
            setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
            setTotal((currentTotal) => Math.max(0, currentTotal - ids.length));
            setViewingEmail((current) => (current && ids.includes(current.id) ? null : current));
            setLoadingEmail((current) => (viewingEmail && ids.includes(viewingEmail.id) ? false : current));
          }
        } catch (e) {
          console.error('WS Parse error', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error', error);
      };

      ws.onclose = async () => {
        if (pingIntervalRef.current) {
          window.clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        if (!active) {
          return;
        }

        try {
          const res = await apiFetch(`${API_BASE}/api/auth/session`);
          if (!res.ok) {
            return;
          }
          const data = (await res.json()) as SessionResponse;
          if (!data.authenticated) {
            handleUnauthorized();
            return;
          }
        } catch (err) {
          console.error('Failed to verify session after socket close', err);
        }

        reconnectTimeoutRef.current = window.setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      active = false;
      closeSocket();
    };
  }, [API_BASE, WS_BASE, apiFetch, authenticated, closeSocket, domainFilter, handleSelectEmail, handleUnauthorized, limit, page, viewingEmail]);

  const handleDelete = async () => {
    if (selectedIds.length === 0) {
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/emails/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      setSelectedIds([]);
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const handleApplyFilter = () => {
    setPage(1);
    const normalizedInput = normalizeDomain(searchInput);
    setSearchInput(normalizedInput);
    setDomainFilter(normalizedInput);
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setAuthError('');

    try {
      const res = await apiFetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: loginKey }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setAuthenticated(false);
        setAuthError(data.error || '登录失败，请检查 API 密钥。');
        return;
      }

      setAuthenticated(true);
      setLoginKey('');
      setAuthError('');
    } catch (err) {
      console.error('Login failed', err);
      setAuthError('登录请求失败，请稍后重试。');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      handleUnauthorized();
      setAuthError('');
      setLoginKey('');
      const url = new URL(window.location.href);
      url.searchParams.delete('email');
      window.history.pushState({}, '', url);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  if (initializing) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!authenticated) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'background.default',
          px: 2,
        }}
      >
        <Paper sx={{ width: '100%', maxWidth: 420, p: 4, borderRadius: 3 }} elevation={6}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
            Infinite Inbox
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            请输入环境变量中配置的 API 密钥后继续访问邮箱系统。
          </Typography>
          {authError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {authError}
            </Alert>
          ) : null}
          <TextField
            type="password"
            label="API Key"
            fullWidth
            autoFocus
            value={loginKey}
            onChange={(e) => setLoginKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            sx={{ mb: 2 }}
          />
          <Button variant="contained" fullWidth onClick={() => void handleLogin()} disabled={loginLoading || !loginKey.trim()}>
            {loginLoading ? '登录中...' : '登录'}
          </Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default', pb: 5 }}>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Toolbar>
          <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 700, color: 'primary.main', letterSpacing: 1 }}>
            Infinite Inbox
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {notificationPermission !== 'granted' ? (
              <Tooltip title={isNotificationSupported ? 'Enable Notifications' : 'Browser notifications are not supported'}>
                <span>
                  <IconButton onClick={requestNotificationPermission} color="warning" disabled={!isNotificationSupported}>
                    <NotificationsOffIcon />
                  </IconButton>
                </span>
              </Tooltip>
            ) : (
              <Tooltip title="Notifications Enabled">
                <IconButton color="success">
                  <NotificationsActiveIcon />
                </IconButton>
              </Tooltip>
            )}
            <TextField
              size="small"
              placeholder="Filter by Domain"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyFilter()}
              sx={{ width: 200 }}
            />
            <Button variant="outlined" onClick={handleApplyFilter}>
              Filter
            </Button>
            <Button startIcon={<RefreshIcon />} onClick={() => void fetchEmails()} color="inherit">
              Refresh
            </Button>
            <Button startIcon={<LogoutIcon />} onClick={() => void handleLogout()} color="inherit">
              Logout
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, alignItems: 'flex-end' }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={selectedIds.length === 0}
              onClick={handleDelete}
              disableElevation
              sx={{ borderRadius: 2 }}
            >
              Delete Selected ({selectedIds.length})
            </Button>
          </Box>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Per Page</InputLabel>
            <Select
              value={limit}
              label="Per Page"
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              <MenuItem value={20}>20</MenuItem>
              <MenuItem value={50}>50</MenuItem>
              <MenuItem value={100}>100</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}>
            <CircularProgress />
          </Box>
        ) : (
          <EmailList
            emails={emails}
            selectedIds={selectedIds}
            onToggleSelect={(id) => {
              setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
            }}
            onToggleSelectAll={(selectAll) => {
              if (selectAll) {
                setSelectedIds(emails.map((e) => e.id));
              } else {
                setSelectedIds([]);
              }
            }}
            onSelectEmail={handleSelectEmail}
          />
        )}

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
            shape="rounded"
          />
        </Box>
      </Container>

      <EmailViewerModal open={!!viewingEmail} email={viewingEmail} onClose={closeEmailViewer} loading={loadingEmail} />
    </Box>
  );
}
