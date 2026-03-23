import { 
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Checkbox, Paper, Typography 
} from '@mui/material';

interface EmailListProps {
  emails: any[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (selectAll: boolean) => void;
  onSelectEmail: (email: any) => void;
}

export default function EmailList({ emails, selectedIds, onToggleSelect, onToggleSelectAll, onSelectEmail }: EmailListProps) {
  const allSelected = emails.length > 0 && selectedIds.length === emails.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < emails.length;

  if (emails.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center', mt: 3, backgroundColor: 'background.paper' }}>
        <Typography variant="h6" color="text.secondary">No emails found.</Typography>
        <Typography variant="body2" color="text.disabled">Waiting for infinite-inbox events...</Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} sx={{ mt: 3, overflow: 'hidden', boxShadow: 3 }}>
      <Table sx={{ minWidth: 650 }}>
        <TableHead sx={{ backgroundColor: 'rgba(0,0,0,0.2)' }}>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                color="primary"
                indeterminate={someSelected}
                checked={allSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </TableCell>
            <TableCell>Subject</TableCell>
            <TableCell>Sender</TableCell>
            <TableCell>Recipient Domain</TableCell>
            <TableCell>Preview</TableCell>
            <TableCell>Received At</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {emails.map((email) => {
            const isSelected = selectedIds.includes(email.id);
            return (
              <TableRow 
                hover 
                key={email.id} 
                selected={isSelected}
                sx={{ 
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                  '&:hover': { backgroundColor: 'action.hover' }
                }}
              >
                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    color="primary"
                    checked={isSelected}
                    onChange={() => onToggleSelect(email.id)}
                  />
                </TableCell>
                <TableCell onClick={() => onSelectEmail(email)}>
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 200 }}>
                    {email.subject}
                  </Typography>
                </TableCell>
                <TableCell onClick={() => onSelectEmail(email)}>
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 150 }}>
                    {email.from_address}
                  </Typography>
                </TableCell>
                <TableCell onClick={() => onSelectEmail(email)}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'primary.light' }}>
                    {email.to_domain}
                  </Typography>
                </TableCell>
                <TableCell onClick={() => onSelectEmail(email)}>
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 250 }}>
                    {email.text_preview}
                  </Typography>
                </TableCell>
                <TableCell onClick={() => onSelectEmail(email)}>
                  <Typography variant="caption" color="text.disabled">
                    {new Date(email.created_at).toLocaleString()}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
