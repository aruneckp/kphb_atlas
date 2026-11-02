CREATE VIRTUAL TABLE voters_fts USING fts5(
  name_key, rel_key, name, rel_name, epic, house_key,
  content='voters', content_rowid='id', tokenize='trigram'
);
