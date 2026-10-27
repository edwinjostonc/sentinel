// Low scores and skipped jobs go to Seen. Unscored jobs (AI error) are left out so the next run retries them.
return $input.all().map((i) => i.json).filter((r) => !r.keep && (r.skipReason || r.scored)).map((r) => ({ json: {
  'Job Link': r.link, 'Date': r.today, 'Fit Score': r.skipReason ? '' : r.fit, 'Note': r.note, 'Key': r.key,
} }));
