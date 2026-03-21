import { Router, Request, Response } from 'express';
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
} from '../db';

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

// GET /api/leads/:id — lead detail + moves
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
  res.json({ lead, moves });
});

// POST /api/leads — create a new lead
router.post('/', (req: Request, res: Response) => {
  const { company_name, role, contact_person, contact_source, date_first_contacted, notes, status } =
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

  const { company_name, role, contact_person, contact_source, date_first_contacted, notes, status } =
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

export default router;
