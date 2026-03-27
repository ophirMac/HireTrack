import { Router, Request, Response } from 'express';
import axios from 'axios';
import {
  listCompanies,
  getCompanyById,
  getInteractionsByCompany,
  deleteCompany,
  updateCompanyStatusManual,
  listCompanyContacts,
  createCompanyContact,
  updateCompanyContact,
  deleteCompanyContact,
  getCompanyContactById,
  getLeadByConvertedCompanyId,
  listLeadMoves,
  listLeadContacts,
  updateLead,
} from '../db';
import { logger } from '../utils/logger';
import { openAIService } from '../services/openai.service';

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

// GET /api/companies/:id — company detail with full interaction timeline + contacts + source lead
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
  const contacts = listCompanyContacts(id);

  const sourceLead = getLeadByConvertedCompanyId(id);
  const sourceLeadMoves = sourceLead ? listLeadMoves(sourceLead.id) : [];
  const sourceLeadContacts = sourceLead ? listLeadContacts(sourceLead.id) : [];

  res.json({ company, interactions, contacts, source_lead: sourceLead ?? null, source_lead_moves: sourceLeadMoves, source_lead_contacts: sourceLeadContacts });
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

// PATCH /api/companies/:id/lead — update the source lead for a converted company
router.patch('/:id/lead', (req: Request, res: Response) => {
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

  const lead = getLeadByConvertedCompanyId(id);
  if (!lead) {
    res.status(404).json({ error: 'No source lead found for this company' });
    return;
  }

  const { role, job_url, contact_person, contact_source, notes, date_first_contacted } = req.body ?? {};

  const updated = updateLead(lead.id, {
    ...(role !== undefined && { role: role ?? null }),
    ...(job_url !== undefined && { job_url: job_url ?? null }),
    ...(contact_person !== undefined && { contact_person: contact_person ?? null }),
    ...(contact_source !== undefined && { contact_source: contact_source ?? null }),
    ...(notes !== undefined && { notes: notes ?? null }),
    ...(date_first_contacted !== undefined && { date_first_contacted: date_first_contacted ?? null }),
  });

  res.json({ lead: updated });
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

// ─── Company Contacts ─────────────────────────────────────────────────────────

// POST /api/companies/extract-linkedin — extract name + role from a LinkedIn profile URL
router.post('/extract-linkedin', async (req: Request, res: Response) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  // Validate LinkedIn URL
  if (!/linkedin\.com\/in\//i.test(url)) {
    res.status(400).json({ error: 'URL must be a LinkedIn profile URL (linkedin.com/in/...)' });
    return;
  }

  let html: string | null = null;
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      responseType: 'text',
    });
    const rawHtml = typeof response.data === 'string' ? response.data : '';
    // Keep html even from authwall pages — og:title meta tags are still present
    html = rawHtml.length >= 500 ? rawHtml : null;
  } catch (err) {
    logger.warn('Failed to fetch LinkedIn URL', { url, error: err instanceof Error ? err.message : err });
  }

  try {
    const result = await openAIService.extractFromLinkedIn(url, html);
    res.json(result);
  } catch (err) {
    logger.error('LinkedIn extraction error', { url, error: err instanceof Error ? err.message : err });
    res.status(500).json({ error: 'Failed to extract LinkedIn profile information' });
  }
});

// GET /api/companies/:id/contacts
router.get('/:id/contacts', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid company id' }); return; }

  const company = getCompanyById(id);
  if (!company) { res.status(404).json({ error: 'Company not found' }); return; }

  res.json({ contacts: listCompanyContacts(id) });
});

// POST /api/companies/:id/contacts
router.post('/:id/contacts', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid company id' }); return; }

  const company = getCompanyById(id);
  if (!company) { res.status(404).json({ error: 'Company not found' }); return; }

  const { name, role, linkedin_url, notes } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const contact = createCompanyContact({
    company_id: id,
    name: name.trim(),
    role: role ?? null,
    linkedin_url: linkedin_url ?? null,
    notes: notes ?? null,
  });

  res.status(201).json({ contact });
});

// PATCH /api/companies/:id/contacts/:contactId
router.patch('/:id/contacts/:contactId', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const contactId = parseInt(req.params.contactId, 10);
  if (isNaN(id) || isNaN(contactId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const contact = getCompanyContactById(contactId);
  if (!contact || contact.company_id !== id) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  const { name, role, linkedin_url, notes } = req.body ?? {};
  const updated = updateCompanyContact(contactId, {
    ...(name !== undefined && { name: String(name).trim() }),
    ...(role !== undefined && { role }),
    ...(linkedin_url !== undefined && { linkedin_url }),
    ...(notes !== undefined && { notes }),
  });

  res.json({ contact: updated });
});

// DELETE /api/companies/:id/contacts/:contactId
router.delete('/:id/contacts/:contactId', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const contactId = parseInt(req.params.contactId, 10);
  if (isNaN(id) || isNaN(contactId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const contact = getCompanyContactById(contactId);
  if (!contact || contact.company_id !== id) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  deleteCompanyContact(contactId);
  res.json({ success: true });
});

export default router;
