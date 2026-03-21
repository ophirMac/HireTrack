import { Router, Request, Response } from 'express';
import {
  listCompanies,
  getCompanyById,
  getInteractionsByCompany,
  deleteCompany,
  updateCompanyStatusManual,
} from '../db';

const router = Router();
const ALLOWED_STATUSES = [
  'applied',
  'rejected',
  'offer',
] as const;

// GET /api/companies — list all companies with interaction count
router.get('/', (_req: Request, res: Response) => {
  const companies = listCompanies();
  res.json({ companies });
});

// GET /api/companies/:id — company detail with full interaction timeline
router.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid company id' });
    return;
  }

  const company = getCompanyById(id);
  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  const interactions = getInteractionsByCompany(id);
  res.json({ company, interactions });
});

// PATCH /api/companies/:id/status — manually update company current_status
router.patch('/:id/status', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid company id' });
    return;
  }

  const status = req.body?.status as string | undefined;
  if (!status || !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const company = getCompanyById(id);
  if (!company) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  updateCompanyStatusManual(id, status);
  const updated = getCompanyById(id);
  res.json({ company: updated });
});

// DELETE /api/companies/:id — permanently remove a company and its related data
router.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid company id' });
    return;
  }

  const deleted = deleteCompany(id);
  if (!deleted) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
