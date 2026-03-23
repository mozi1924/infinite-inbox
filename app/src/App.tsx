import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Container, Typography, Box, Toolbar, AppBar, Select, MenuItem,
  FormControl, InputLabel, Button, TextField, Pagination, CircularProgress, IconButton, Tooltip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import EmailList from './components/EmailList';
import EmailViewerModal from './components/EmailViewerModal';

// Set backend URL for dev or prod seamlessly
const isDev = import.meta.env.DEV || window.location.port === '5173';
const API_BASE = isDev ? 'http://localhost:8787' : '';
const WS_BASE = isDev 
  ? 'ws://localhost:8787/api/ws' 
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

export default function App() {
  const [emails, setEmails] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(Notification.permission);
  
  // State for filtering & pagination
  const [domainFilter, setDomainFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);
  
  // State for selections & modal
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewingEmail, setViewingEmail] = useState<any | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const handleSelectEmail = async (email: any) => {
    setViewingEmail(email); // Show partial first
    setLoadingEmail(true);

    // Update URL seamlessly
    const url = new URL(window.location.href);
    url.searchParams.set('email', email.id);
    window.history.pushState({}, '', url);

    try {
      const res = await fetch(`${API_BASE}/api/emails/${email.id}`);
      const full = await res.json();
      setViewingEmail(full);
    } catch (err) {
      console.error("Failed to load full email", err);
    } finally {
      setLoadingEmail(false);
    }
  };

  const closeEmailViewer = () => {
    setViewingEmail(null);
    setLoadingEmail(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('email');
    window.history.pushState({}, '', url);
  };

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<any>(null);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  // Handle Initial Deep Link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailId = params.get('email');
    if (emailId) {
      handleSelectEmail({ id: emailId, subject: 'Loading...', from_address: '...', text_preview: '' });
    }
    
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const emailId = params.get('email');
      if (emailId) handleSelectEmail({ id: emailId, subject: 'Loading...', from_address: '', text_preview: '' });
      else {
        setViewingEmail(null);
        setLoadingEmail(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      let url = `${API_BASE}/api/emails?limit=${limit}&offset=${offset}`;
      if (domainFilter) url += `&domain=${encodeURIComponent(domainFilter)}`;
      
      const res = await fetch(url);
      const data = await res.json();
      setEmails(data.emails || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      setLoading(false);
    }
  }, [domainFilter, limit, page]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  useEffect(() => {
    const connectWs = () => {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 30000); // 30s keep-alive
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'NEW_EMAIL') {
            const email = data.email;
            
            // Dispatch Notification
            if (Notification.permission === 'granted') {
              const notification = new Notification(`New Email: ${email.subject}`, {
                body: `From: ${email.from_address}\n${email.text_preview}`,
              });
              notification.onclick = () => {
                window.focus();
                handleSelectEmail(email);
              };
            }

            // Only add if it matches current domain filter
            setDomainFilter((currentFilter) => {
              if (!currentFilter || currentFilter === email.to_domain) {
                setEmails(prev => {
                  const newEmails = [email, ...prev];
                  // If we exceed limit, we could pop, but let's just keep it simple
                  // or trigger a refetch if pagination is complex
                  return newEmails;
                });
                setTotal(t => t + 1);
              }
              return currentFilter;
            });
          } else if (data.type === 'DELETE_EMAILS') {
            const ids = data.ids as string[];
            setEmails(prev => prev.filter(e => !ids.includes(e.id)));
            setTotal(t => Math.max(0, t - ids.length));
          }
        } catch (e) {
          console.error("WS Parse error", e);
        }
      };

      ws.onclose = () => {
        clearInterval(pingIntervalRef.current);
        setTimeout(connectWs, 3000); // Reconnect
      };
    };

    connectWs();
    return () => {
      clearInterval(pingIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await fetch(`${API_BASE}/api/emails/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      // WebSocket will broadcast DELETE_EMAILS, and UI will update automatically.
      setSelectedIds([]);
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const handleApplyFilter = () => {
    setPage(1);
    setDomainFilter(searchInput);
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default', pb: 5 }}>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Toolbar>
          <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 700, color: 'primary.main', letterSpacing: 1 }}>
            Infinite Inbox
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {notificationPermission !== 'granted' ? (
              <Tooltip title="Enable Notifications">
                <IconButton onClick={requestNotificationPermission} color="warning">
                  <NotificationsOffIcon />
                </IconButton>
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
            <Button variant="outlined" onClick={handleApplyFilter}>Filter</Button>
            <Button startIcon={<RefreshIcon />} onClick={fetchEmails} color="inherit">Refresh</Button>
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
              setSelectedIds(prev => 
                prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
              );
            }}
            onToggleSelectAll={(selectAll) => {
              if (selectAll) setSelectedIds(emails.map(e => e.id));
              else setSelectedIds([]);
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

      <EmailViewerModal 
        open={!!viewingEmail} 
        email={viewingEmail} 
        onClose={closeEmailViewer} 
        loading={loadingEmail}
      />
    </Box>
  );
}
