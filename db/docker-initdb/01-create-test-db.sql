-- Runs automatically, once, the first time the container initializes an empty
-- data volume (the official postgres image behaviour for anything mounted at
-- /docker-entrypoint-initdb.d). POSTGRES_DB only auto-creates ottodot_trial;
-- without this, ottodot_trial_test never exists and `npm test` fails on a
-- fresh checkout with "database ... does not exist" until someone manually
-- runs createdb. This closes that gap at the source, on cold start.
CREATE DATABASE ottodot_trial_test;
