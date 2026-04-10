/**
 * One-time backfill: absorb leads into matching companies.
 *
 * For each non-converted lead, checks if a company with the same name already
 * exists. If so, migrates the lead's contacts to company contacts and deletes
 * the lead (cascades to lead_moves and lead_contacts).
 */

import 'dotenv/config';
import {
  listLeads,
  findCompanyByName,
  listLeadContacts,
  createCompanyContact,
  deleteLead,
} from '../db';

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function main() {
  const leads = listLeads().filter((l) => l.status !== 'converted');
  console.log(`Found ${leads.length} non-converted lead(s) to check.\n`);

  let absorbed = 0;

  for (const lead of leads) {
    const company = findCompanyByName(lead.company_name);
    if (!company) continue;

    // Extra guard: ensure names are actually similar (not a spurious LIKE match)
    if (normalize(company.name) !== normalize(lead.company_name) &&
        !normalize(company.name).includes(normalize(lead.company_name)) &&
        !normalize(lead.company_name).includes(normalize(company.name))) {
      continue;
    }

    const contacts = listLeadContacts(lead.id);
    for (const c of contacts) {
      createCompanyContact({
        company_id: company.id,
        name: c.name,
        role: c.role,
        linkedin_url: c.linkedin_url,
        notes: c.notes,
      });
    }

    deleteLead(lead.id);
    absorbed++;

    console.log(`✓ Lead "${lead.company_name}" (id=${lead.id}) → Company "${company.name}" (id=${company.id}) | ${contacts.length} contact(s) migrated`);
  }

  console.log(`\nDone. ${absorbed} lead(s) absorbed and deleted.`);
}

main();
