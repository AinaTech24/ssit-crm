-- Retire the "Limited Team Member" role; introduce Assistant and Gifting / HR.
--
-- team_member was the catch-all limited seat: assigned tasks and nothing else.
-- It is replaced by `assistant`, which carries exactly the same grants under a
-- name that says what the person actually does. Anyone still holding
-- team_member is moved across rather than left with a role the code no longer
-- knows — an unknown role grants nothing, so leaving it would silently strip
-- those users of the little access they had.
--
-- `gifting_hr` is new and is not back-filled onto anyone: it is a seat an owner
-- assigns deliberately, and it carries a firm-wide client read (it must be able
-- to pick any client as a gift recipient).
--
-- roles is a plain text[] with no CHECK constraint or pg enum, so there is
-- nothing to alter besides the data itself.

UPDATE users
   SET roles = array_replace(roles, 'team_member', 'assistant'),
       updated_at = now()
 WHERE 'team_member' = ANY (roles);

-- The per-firm role master (Settings → Masters) lists roles for pickers. Same
-- rename, same reason: a stale key would render as a role that cannot be used.
UPDATE master_values
   SET key = 'assistant',
       label = 'Assistant',
       updated_at = now()
 WHERE key = 'team_member';
