// Map kept jobs to the Jobs tab columns.
return $input.all().map((i) => i.json).filter((r) => r.keep).map((r) => ({ json: {
  'Date Found': r.today, 'Fit Score': r.fit, 'Verdict': r.verdict, 'Role': r.title, 'Company': r.company, 'Country': r.country,
  'Location': r.location, 'Work Mode': r.workMode, 'Visa / Sponsor': r.visa, 'Language': r.language,
  'Salary': r.salaryText, 'Salary (EUR/yr)': r.salaryEur, [SALARY2_HEADER]: r.salary2,
  'Why It Fits': r.why, 'Gaps': r.gaps, 'Resume Changes': r.resumeChanges, 'Job Link': r.link, 'More Links': r.moreLinks,
  'Source': r.source, 'Posted': r.posted, 'Status': 'To apply', 'Applied On': '', 'Follow-up': '', 'Notes': r.flags.join(' · '),
} }));
