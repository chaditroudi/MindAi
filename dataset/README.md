# Dataset Folder

This folder contains safe local JSON files that can be used instead of fetching from a confidential database.

Files:
- `datastores.json`: principal schema structure for the supervisor and runtime validation
- `municipalities.json`: municipality reference rows
- `projects.json`: project rows with both `muni` and nested `municipality` data

Why the nested `municipality` object is included in `projects.json`:
- it lets prompts like `top 5 municipalities with the highest number of in progress projects` work from JSON rows
- it avoids relying on runtime `$lookup` against a database

Suggested usage:
1. keep `datastores.json` as the schema source
2. load `projects.json` as the row dataset for dashboard/report/inquiry
3. replace these sample rows with sanitized exported rows from your secure system
