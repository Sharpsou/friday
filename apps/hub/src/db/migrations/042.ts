export const MIGRATION_042 = `
  ALTER TABLE chat_conversations
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'friday'
    CHECK (mode IN ('friday', 'local', 'web'));
  ALTER TABLE chat_runs
    ADD COLUMN requested_mode TEXT NOT NULL DEFAULT 'friday'
    CHECK (requested_mode IN ('friday', 'local', 'web'));

  UPDATE chat_conversations
     SET title = substr(
       (SELECT trim(replace(replace(message.content, char(13), ' '), char(10), ' '))
          FROM chat_messages message
         WHERE message.conversation_id = chat_conversations.id
           AND message.role = 'user'
         ORDER BY message.ordinal
         LIMIT 1),
       1,
       80
     )
   WHERE title = 'Nouvelle conversation'
     AND EXISTS (
       SELECT 1 FROM chat_messages message
        WHERE message.conversation_id = chat_conversations.id
          AND message.role = 'user'
     );
`;
