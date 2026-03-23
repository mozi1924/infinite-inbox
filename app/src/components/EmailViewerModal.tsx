import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Chip, IconButton, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface EmailViewerModalProps {
  open: boolean;
  email: any;
  loading?: boolean;
  onClose: () => void;
}

export default function EmailViewerModal({ open, email, loading, onClose }: EmailViewerModalProps) {
  if (!email) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { minHeight: '60vh' } }}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        <Typography variant="h6" noWrap sx={{ flex: 1, fontWeight: 700 }}>
          {email.subject}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip label={`From: ${email.from_address}`} color="primary" variant="outlined" />
          <Chip label={`To: ${email.to_address}`} color="secondary" variant="outlined" />
          <Chip label={`Domain: ${email.to_domain}`} variant="outlined" />
          <Chip label={new Date(email.created_at).toLocaleString()} variant="outlined" />
        </Box>
        
        <Box sx={{ flex: 1, backgroundColor: 'white', color: 'black', borderRadius: 1, overflow: 'hidden', minHeight: 400, display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <CircularProgress />
            </Box>
          ) : email.html_content ? (
            <iframe
              title="Email Content"
              srcDoc={email.html_content}
              style={{ flex: 1, width: '100%', border: 'none' }}
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            />
          ) : (
            <Box sx={{ p: 2, whiteSpace: 'pre-wrap', fontFamily: 'monospace', flex: 1, overflowY: 'auto' }}>
              {email.text_content || 'No content provided.'}
            </Box>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose} color="primary" variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
