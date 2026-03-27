import { Router, Request, Response } from 'express';
import axios from 'axios';
import {
  listLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  convertLead,
  listLeadMoves,
  createLeadMove,
  deleteLeadMove,
  findCompanyByName,
  createCompany,
  listLeadContacts,
  createLeadContact,
  updateLeadContact,
  deleteLeadContact,
} from '../db';
import { logger } from '../utils/logger';
import { openAIService } from '../services/openai.service';

const router = Router();

const ALLOWED_STATUSES = [
  'researching',
  'contacted',
  'waiting_response',
  'preparing_to_apply',
  'applied',
  'converted',
] as const;

const ALLOWED_SOURCES = ['linkedin', 'email', 'referral', 'event', 'other'] as const;

// GET /api/leads — list all leads, optional ?status= filter
router.get('/', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const leads = listLeads(status);
  res.json({ leads });
});

// ─── URL Extraction (must be before /:id to avoid param capture) ──────────────

const CONTACT_STATUSES = ['identified', 'connected', 'messaged', 'replied', 'referred'] as const;

// POST /api/leads/extract-url — extract company name & role from a job URL using AI
router.post('/extract-url', async (req: Request, res: Response) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL format' });
    return;
  }

  let html = '';
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      responseType: 'text',
    });
    html = typeof response.data === 'string' ? response.data : '';
  } catch (err) {
    logger.warn('Failed to fetch URL', { url, error: err instanceof Error ? err.message : err });
  }

  // If OpenAI is configured and we got HTML, use AI extraction
  if (openAIService.isConfigured() && html) {
    try {
      const result = await openAIService.extractFromJobPage(html, url);
      res.json({
        company_name: result.companyName,
        role: result.role,
      });
      return;
    } catch (err) {
      logger.warn('AI extraction failed, falling back to domain', { url, error: err instanceof Error ? err.message : err });
    }
  }

  // Fallback: extract company name from domain
  let companyName = '';
  try {
    const parsedUrl = new URL(url);
    companyName = parsedUrl.hostname
      .replace(/^www\./, '')
      .replace(/\.(com|org|net|io|co|jobs).*$/, '')
      .split('.')
      .pop() ?? '';
    companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
  } catch {
    // ignore
  }

  res.json({
    company_name: companyName,
    role: '',
    warning: html
      ? 'AI extraction not available. Company name guessed from URL domain.'
      : 'Could not fetch page. Company name guessed from URL domain.',
  });
});

// GET /api/leads/:id — lead detail + moves + contacts
router.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const moves = listLeadMoves(id);
  const contacts = listLeadContacts(id);
  res.json({ lead, moves, contacts });
});

// POST /api/leads — create a new lead
router.post('/', (req: Request, res: Response) => {
  const { company_name, role, job_url, contact_person, contact_source, date_first_contacted, notes, status } =
    req.body ?? {};

  if (!company_name || typeof company_name !== 'string' || !company_name.trim()) {
    res.status(400).json({ error: 'company_name is required' });
    return;
  }

  if (
    contact_source !== undefined &&
    contact_source !== null &&
    !ALLOWED_SOURCES.includes(contact_source)
  ) {
    res.status(400).json({ error: 'Invalid contact_source' });
    return;
  }

  if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const lead = createLead({
    company_name: company_name.trim(),
    role: role ?? null,
    job_url: job_url ?? null,
    contact_person: contact_person ?? null,
    contact_source: contact_source ?? null,
    date_first_contacted: date_first_contacted ?? null,
    status: status ?? 'researching',
    notes: notes ?? null,
  });

  res.status(201).json({ lead });
});

// PATCH /api/leads/:id — update lead fields
router.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const { company_name, role, job_url, contact_person, contact_source, date_first_contacted, notes, status } =
    req.body ?? {};

  if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  if (
    contact_source !== undefined &&
    contact_source !== null &&
    !ALLOWED_SOURCES.includes(contact_source)
  ) {
    res.status(400).json({ error: 'Invalid contact_source' });
    return;
  }

  const updated = updateLead(id, {
    ...(company_name !== undefined && { company_name }),
    ...(role !== undefined && { role }),
    ...(job_url !== undefined && { job_url }),
    ...(contact_person !== undefined && { contact_person }),
    ...(contact_source !== undefined && { contact_source }),
    ...(date_first_contacted !== undefined && { date_first_contacted }),
    ...(notes !== undefined && { notes }),
    ...(status !== undefined && { status }),
  });

  res.json({ lead: updated });
});

// DELETE /api/leads/:id — delete a lead and all its moves
router.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const deleted = deleteLead(id);
  if (!deleted) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  res.json({ success: true });
});

// POST /api/leads/:id/moves — add a move to a lead's timeline
router.post('/:id/moves', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const { date, description, person_contacted, link } = req.body ?? {};

  if (!date || typeof date !== 'string') {
    res.status(400).json({ error: 'date is required' });
    return;
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const move = createLeadMove({
    lead_id: id,
    date,
    description: description.trim(),
    person_contacted: person_contacted ?? null,
    link: link ?? null,
  });

  res.status(201).json({ move });
});

// DELETE /api/leads/:id/moves/:moveId — remove a move
router.delete('/:id/moves/:moveId', (req: Request, res: Response) => {
  const moveId = parseInt(req.params.moveId, 10);
  if (isNaN(moveId)) {
    res.status(400).json({ error: 'Invalid move id' });
    return;
  }

  const deleted = deleteLeadMove(moveId);
  if (!deleted) {
    res.status(404).json({ error: 'Move not found' });
    return;
  }

  res.json({ success: true });
});

// POST /api/leads/:id/convert — convert lead to a company application
router.post('/:id/convert', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  if (lead.status === 'converted') {
    res.status(409).json({ error: 'Lead is already converted', converted_company_id: lead.converted_company_id });
    return;
  }

  // Reuse existing company if name matches, otherwise create a new one
  let company = findCompanyByName(lead.company_name);

  if (!company) {
    company = createCompany({
      name: lead.company_name,
      current_status: 'applied',
      first_interaction_at: lead.date_first_contacted ?? new Date().toISOString(),
      last_interaction_at: lead.date_first_contacted ?? new Date().toISOString(),
    });
  }

  convertLead(id, company.id);

  // Record a timeline entry capturing the referral source and notes at conversion time
  const parts: string[] = ['Converted to company application.'];
  if (lead.contact_source) {
    parts.push(`Source: ${lead.contact_source}.`);
  }
  if (lead.notes && lead.notes.trim()) {
    parts.push(`Notes: ${lead.notes.trim()}`);
  }

  createLeadMove({
    lead_id: id,
    date: new Date().toISOString().split('T')[0],
    description: parts.join(' '),
    person_contacted: lead.contact_person ?? null,
  });

  const updatedLead = getLeadById(id);
  res.json({ lead: updatedLead, company });
});

// ─── Lead Contacts ────────────────────────────────────────────────────────────

// GET /api/leads/:id/contacts — list contacts for a lead
router.get('/:id/contacts', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const contacts = listLeadContacts(id);
  res.json({ contacts });
});

// POST /api/leads/:id/contacts — add a contact to a lead
router.post('/:id/contacts', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid lead id' });
    return;
  }

  const lead = getLeadById(id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const { name, role, linkedin_url, status, notes } = req.body ?? {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  if (status !== undefined && !CONTACT_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid contact status. Allowed: ' + CONTACT_STATUSES.join(', ') });
    return;
  }

  const contact = createLeadContact({
    lead_id: id,
    name: name.trim(),
    role: role ?? null,
    linkedin_url: linkedin_url ?? null,
    status: status ?? 'identified',
    notes: notes ?? null,
  });

  res.status(201).json({ contact });
});

// PATCH /api/leads/:id/contacts/:contactId — update a contact
router.patch('/:id/contacts/:contactId', (req: Request, res: Response) => {
  const contactId = parseInt(req.params.contactId, 10);
  if (isNaN(contactId)) {
    res.status(400).json({ error: 'Invalid contact id' });
    return;
  }

  const { name, role, linkedin_url, status, notes } = req.body ?? {};

  if (status !== undefined && !CONTACT_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid contact status. Allowed: ' + CONTACT_STATUSES.join(', ') });
    return;
  }

  const updated = updateLeadContact(contactId, {
    ...(name !== undefined && { name }),
    ...(role !== undefined && { role }),
    ...(linkedin_url !== undefined && { linkedin_url }),
    ...(status !== undefined && { status }),
    ...(notes !== undefined && { notes }),
  });

  if (!updated) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  res.json({ contact: updated });
});

// DELETE /api/leads/:id/contacts/:contactId — remove a contact
router.delete('/:id/contacts/:contactId', (req: Request, res: Response) => {
  const contactId = parseInt(req.params.contactId, 10);
  if (isNaN(contactId)) {
    res.status(400).json({ error: 'Invalid contact id' });
    return;
  }

  const deleted = deleteLeadContact(contactId);
  if (!deleted) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
