import { Router, Request, Response } from 'express';
import {
  listCompanies,
  getCompanyById,
  getInteractionsByCompany,
} from '../db';

const router = Router();

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

export default router;
